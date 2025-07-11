
// CONFIGURATION – make these exactly your bucket names!
const DRIVE_FOLDER_ID     = '';
const GCS_INPUT_BUCKET    = '-inputs';
const GCS_OUTPUT_BUCKET   = '-outputs';
const GCS_INPUT_PREFIX    = '';   // if you want to drop files at the bucket root, leave blank
const GCS_OUTPUT_PREFIX   = '';   // same here
const NUMBERS_TO_FIND     = [ ];

/**
 * Start Vision OCR on each PDF in the input bucket
 *    Builds one request per file, since Vision requires single-file URIs.
 */
function startVisionOcr() {
  const token = ScriptApp.getOAuthToken();
  const bucket = GCS_INPUT_BUCKET;         // 'invoicing-inputs'
  const prefix = GCS_INPUT_PREFIX;         // e.g. '' or 'some/subfolder'
  
  // List all objects under invoices-inputs/
  const listUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o`
                + (prefix ? `?prefix=${encodeURIComponent(prefix + '/')}` : '');
  const listRes = UrlFetchApp.fetch(listUrl, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (listRes.getResponseCode() !== 200) {
    throw new Error('Failed listing input bucket: ' + listRes.getContentText());
  }
  const items = JSON.parse(listRes.getContentText()).items || [];
  
  if (!items.length) {
    throw new Error('No PDFs found in input bucket.');
  }
  
  // Build one Vision request per PDF
  const visionRequests = items
    .filter(o => o.name.toLowerCase().endsWith('.pdf'))
    .map(o => ({
      inputConfig: {
        gcsSource: { uri: `gs://${bucket}/${o.name}` },
        mimeType: 'application/pdf'
      },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      outputConfig: {
        gcsDestination: { uri: `gs://${GCS_OUTPUT_BUCKET}/${GCS_OUTPUT_PREFIX}/` },
        batchSize: 1
      }
    }));
  
  if (!visionRequests.length) {
    throw new Error('No PDF files in bucket to OCR.');
  }
  
  // Submit all in one asyncBatchAnnotate call
  const endpoint = 'https://vision.googleapis.com/v1/files:asyncBatchAnnotate';
  const payload  = JSON.stringify({ requests: visionRequests });
  const res = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload
  });
  
  if (res.getResponseCode() !== 200) {
    throw new Error('Vision start failed: ' + res.getContentText());
  }
  const op = JSON.parse(res.getContentText());
  Logger.log('Vision OCR operation started: %s', op.name);
  return op.name;
}

// Poll until the Vision operation completes
function waitForVisionOperation(opName, timeoutSec = 300) {
  const token = ScriptApp.getOAuthToken();
  const url   = `https://vision.googleapis.com/v1/${opName}`;
  const start = Date.now();

  while (Date.now() - start < timeoutSec * 1000) {
    Utilities.sleep(5000);
    const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const status = JSON.parse(res.getContentText());
    if (status.done) {
      Logger.log('Vision OCR operation completed.');
      return;
    }
  }
  throw new Error('Vision OCR timed out after ' + timeoutSec + ' seconds');
}

// List and fetch all OCR JSON objects from the output bucket
function listGcsObjects(bucket, prefix) {
  const token = ScriptApp.getOAuthToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o`
            + (prefix ? `?prefix=${encodeURIComponent(prefix + '/')}` : '');
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (res.getResponseCode() !== 200) {
    throw new Error(`Failed to list objects in ${bucket}: ${res.getContentText()}`);
  }
  return JSON.parse(res.getContentText()).items || [];
}

function getGcsObjectText(bucket, objectName) {
  const token = ScriptApp.getOAuthToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(objectName)}?alt=media`;
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (res.getResponseCode() !== 200) {
    throw new Error(`Failed to fetch ${objectName}: ${res.getContentText()}`);
  }
  return res.getContentText();
}


function startVisionOcr() {
  const token = ScriptApp.getOAuthToken();
  const pdfObjects = listGcsObjects(GCS_INPUT_BUCKET, GCS_INPUT_PREFIX)
    .filter(o => o.name.toLowerCase().endsWith('.pdf'));

  // Kick off a separate OCR job per PDF
  return pdfObjects.map(o => {
    const pdfName = o.name;                              // e.g. "SO 55895.pdf"
    const base    = pdfName.replace(/\.pdf$/i, '');      // "SO 55895"

    const request = {
      requests: [{
        inputConfig: {
          // Use the raw object name, **not** encodeURIComponent
          gcsSource: { uri: `gs://${GCS_INPUT_BUCKET}/${pdfName}` },
          mimeType: 'application/pdf'
        },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        outputConfig: {
          // Put each PDF's outputs under its own folder
          gcsDestination: { uri: `gs://${GCS_OUTPUT_BUCKET}/${base}/` },
          batchSize: 1
        }
      }]
    };

    const res = UrlFetchApp.fetch(
      'https://vision.googleapis.com/v1/files:asyncBatchAnnotate',
      {
        method:      'post',
        contentType: 'application/json',
        headers:     { Authorization: 'Bearer ' + token },
        payload:     JSON.stringify(request)
      }
    );
    if (res.getResponseCode() !== 200) {
      throw new Error(`Vision start failed for ${pdfName}: ${res.getContentText()}`);
    }
    const op = JSON.parse(res.getContentText());
    Logger.log('OCR job for %s started: %s', pdfName, op.name);
    return { pdfName, base, opName: op.name };
  });
}


/**
 * Main entrypoint: runs the full pipeline
 * Scans each PDF’s OCR text and returns a map:
 *   { "Statement 235.pdf": ["5583-6","SO55919"], ... }
 */
function scanFolderPdfsForNumbers() {
  // 1) Kick off per-PDF OCR jobs
  const jobs = startVisionOcr();             // returns [{pdfName, base, opName},…]
  jobs.forEach(job => waitForVisionOperation(job.opName));

  const found = {};

  jobs.forEach(({ pdfName, base }) => {
    // 2) List exactly that PDF’s OCR JSONs
    const outputs = listGcsObjects(GCS_OUTPUT_BUCKET, base);
    if (!outputs.length) {
      Logger.log(`No OCR output for ${pdfName}`);
      return;
    }

    // 3) Pull all text for this PDF
    let fullText = '';
    outputs.forEach(o => {
      const data = JSON.parse(getGcsObjectText(GCS_OUTPUT_BUCKET, o.name));
      (data.responses || []).forEach(r => {
        if (r.fullTextAnnotation?.text) {
          fullText += r.fullTextAnnotation.text + ' ';
        }
      });
    });

    // 4) Scan for each number
    NUMBERS_TO_FIND.forEach(num => {
      if (fullText.includes(num)) {
        found[pdfName] = found[pdfName] || [];
        if (!found[pdfName].includes(num)) {
          found[pdfName].push(num);
          Logger.log(`✔ ${pdfName}: found "${num}"`);
        }
      }
    });
  });

  Logger.log('Summary: ' + JSON.stringify(found, null, 2));
  return found;
}


// HELPERS 
function uploadPdfsToGcs() {
  const token = ScriptApp.getOAuthToken();
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const files  = folder.getFilesByType(MimeType.PDF);

  while (files.hasNext()) {
    const file = files.next();
    const blob = file.getBlob();
    // Build object name: optional prefix + filename
    const objectName = (GCS_INPUT_PREFIX ? GCS_INPUT_PREFIX + '/' : '') + file.getName();
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${GCS_INPUT_BUCKET}/o`
              + `?uploadType=media&name=${encodeURIComponent(objectName)}`;

    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: blob.getContentType(),
      headers: { Authorization: 'Bearer ' + token },
      payload: blob.getBytes()
    });

    if (res.getResponseCode() !== 200) {
      throw new Error(`Upload failed for ${file.getName()}: ${res.getContentText()}`);
    }
    Logger.log(`Uploaded to gs://${GCS_INPUT_BUCKET}/${objectName}`);
  }
}

/**
 * Deletes every object in the given GCS bucket under the optional prefix.
 *
 * @param {string} bucketName  The name of your GCS bucket.
 * @param {string} [prefix]    (Optional) Only delete objects whose names start with this prefix.
 */
function clearGcsBucket(bucketName, prefix = '') {
  const token = ScriptApp.getOAuthToken();
  const listUrl =
    `https://storage.googleapis.com/storage/v1/b/${bucketName}/o` +
    (prefix ? `?prefix=${encodeURIComponent(prefix)}` : '');
  // 1) List all objects
  const listRes = UrlFetchApp.fetch(listUrl, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (listRes.getResponseCode() !== 200) {
    throw new Error(`Failed to list objects in ${bucketName}: ${listRes.getContentText()}`);
  }
  const items = JSON.parse(listRes.getContentText()).items || [];
  
  // 2) Delete each object
  items.forEach(obj => {
    const deleteUrl = 
      `https://storage.googleapis.com/storage/v1/b/${bucketName}/o/` +
      encodeURIComponent(obj.name);
    const delRes = UrlFetchApp.fetch(deleteUrl, {
      method: 'delete',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (delRes.getResponseCode() !== 204) {
      Logger.log(`⚠️ Could not delete gs://${bucketName}/${obj.name}: ${delRes.getResponseCode()}`);
    } else {
      Logger.log(`Deleted gs://${bucketName}/${obj.name}`);
    }
  });
}

/**
 * Clears both your invoicing-inputs and invoicing-outputs buckets.
 */
function clearAllBuckets() {
  // Replace these names if yours differ
  const inputBucket  = 'invoicing-inputs';
  const outputBucket = 'invoicing-outputs';
  
  Logger.log('Clearing input bucket...');
  clearGcsBucket(inputBucket);
  
  Logger.log('Clearing output bucket...');
  clearGcsBucket(outputBucket);
  
  Logger.log('All buckets cleared.');
}