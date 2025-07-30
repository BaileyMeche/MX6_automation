// const GCS_BUCKET_NAME   = 'invoice-auto-465519';   // replace with your GCP project ID

/**
 * CONFIGURATION – make these exactly your bucket names!
 */
const DRIVE_FOLDER_ID     = '1h6NB9RaT1z1lPXq0RoSJy3AyApUyd5bu';
const GCS_INPUT_BUCKET    = 'invoicing-input';
const GCS_OUTPUT_BUCKET   = 'invoicing-output';
const GCS_INPUT_PREFIX    = '';   // if you want to drop files at the bucket root, leave blank
const GCS_OUTPUT_PREFIX   = '';   // same here
//const NUMBERS_TO_FIND     = ['7172025']
  // '56014', '56105', '56126', '2852', '56174', '56160']; 
//"7172025-2", "7172025-1", "7172025-3", "71125-1", "5583-9R", "5583-10R", "5583-11", "5583-12", "5587-3", "5583-13", "07192025-Air", "2500723-10", "5583-11R",
const YOUR_PROJECT_ID     = 'invoice-auto-admin'

const FOLDER_KEY_MAP = {
    '27822': ['7172025-2'],
    '27823': ['7172025-1'],
    '27824': ['7172025-3'],
    '27847': ['71125-1', '56014'],
    '27848': ['5583-9R', '56105'],
    '27849': ['5583-10R', '56126'],
    '27850': ['5583-11'],
    '27851': ['5583-12'],
    '27854': ['5587-3'],
    '27868': ['5583-13'],
    '27877': ['07192025-Air', '2852'],
    '27878': ['2500723-10', '56174'],
    '27879': [ ],
    '27880': ['5583-11R', '56160'],
    // you can add more keys mapping to multiple labels, e.g.
    // '12345': ['A139807', '7172025-2']
  };

const NUMBERS_TO_FIND = Array.from(
  new Set(
    Object.values(FOLDER_KEY_MAP).flat()
  ))

/**
 * 2️⃣ Start Vision OCR on PDFs in the input bucket, writing JSON to the output bucket
 */
/**
 * 2️⃣ Start Vision OCR on each PDF in the input bucket
 *    Builds one request per file, since Vision requires single-file URIs.
 */
function startVisionOcr() {
  const token = ScriptApp.getOAuthToken();
  const bucket = GCS_INPUT_BUCKET;         // 'invoicing-inputs'
  const prefix = GCS_INPUT_PREFIX;         // e.g. '' or 'some/subfolder'
  
  // 1) List all objects under invoices-inputs/
  const listUrl = https://storage.googleapis.com/storage/v1/b/${bucket}/o
                + (prefix ? ?prefix=${encodeURIComponent(prefix + '/')} : '');
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
  
  // 2) Build one Vision request per PDF
  const visionRequests = items
    .filter(o => o.name.toLowerCase().endsWith('.pdf'))
    .map(o => ({
      inputConfig: {
        gcsSource: { uri: gs://${bucket}/${o.name} },
        mimeType: 'application/pdf'
      },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      outputConfig: {
        gcsDestination: { uri: gs://${GCS_OUTPUT_BUCKET}/${GCS_OUTPUT_PREFIX}/ },
        batchSize: 1
      }
    }));
  
  if (!visionRequests.length) {
    throw new Error('No PDF files in bucket to OCR.');
  }
  
  // 3) Submit all in one asyncBatchAnnotate call
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


/**
 * 3️⃣ Poll until the Vision operation completes
 */
function waitForVisionOperation(opName, timeoutSec = 300) {
  const token = ScriptApp.getOAuthToken();
  const url   = https://vision.googleapis.com/v1/${opName};
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

/**
 * 4️⃣ List and fetch all OCR JSON objects from the output bucket
 */
function listGcsObjects(bucket, prefix) {
  const token = ScriptApp.getOAuthToken();
  const url = https://storage.googleapis.com/storage/v1/b/${bucket}/o
            + (prefix ? ?prefix=${encodeURIComponent(prefix + '/')} : '');
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (res.getResponseCode() !== 200) {
    throw new Error(Failed to list objects in ${bucket}: ${res.getContentText()});
  }
  return JSON.parse(res.getContentText()).items || [];
}

function getGcsObjectText(bucket, objectName) {
  const token = ScriptApp.getOAuthToken();
  const url = https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(objectName)}?alt=media;
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (res.getResponseCode() !== 200) {
    throw new Error(Failed to fetch ${objectName}: ${res.getContentText()});
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
          gcsSource: { uri: gs://${GCS_INPUT_BUCKET}/${pdfName} },
          mimeType: 'application/pdf'
        },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        outputConfig: {
          // Put each PDF's outputs under its own folder
          gcsDestination: { uri: gs://${GCS_OUTPUT_BUCKET}/${base}/ },
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
      throw new Error(Vision start failed for ${pdfName}: ${res.getContentText()});
    }
    const op = JSON.parse(res.getContentText());
    Logger.log('📤 OCR job for %s started: %s', pdfName, op.name);
    return { pdfName, base, opName: op.name };
  });
}

/**
 * Copies & renames matched PDFs into GCS, then saves them
 * into a Drive folder by its ID.
 *
 * @param {Object} foundMap          Map of pdfName → [numbersFound]
 * @param {string} folderId  The Drive folder ID to save into
 */
function copyRenameAndDownloadMatchedPdfs(foundMap, folderId) {
  const token       = ScriptApp.getOAuthToken();
  // 1) Use the provided folder ID instead of auto-creating
  const file = Drive.Files.get(folderId, { supportsAllDrives: true });
  const driveFolder = DriveApp.getFolderById(folderId);


  Object.entries(foundMap).forEach(([pdfName, nums]) => {
    if (!nums.length) return;
    const newName = ${nums[0]}.pdf;

    // Fetch from INPUT bucket
    const inputRes = UrlFetchApp.fetch(
      https://storage.googleapis.com/storage/v1/b/${GCS_INPUT_BUCKET}/o/${encodeURIComponent(pdfName)}?alt=media,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    if (inputRes.getResponseCode() !== 200) {
      Logger.log(⚠️ Failed to fetch ${pdfName}: ${inputRes.getResponseCode()});
      return;
    }
    const pdfBlob = inputRes.getBlob().setName(newName);

    // Upload to OUTPUT bucket
    const uploadRes = UrlFetchApp.fetch(
      https://storage.googleapis.com/upload/storage/v1/b/${GCS_OUTPUT_BUCKET}/o?uploadType=media&name=${encodeURIComponent(newName)},
      {
        method:      'post',
        contentType: 'application/pdf',
        headers:     { Authorization: 'Bearer ' + token },
        payload:     pdfBlob.getBytes()
      }
    );
    if (uploadRes.getResponseCode() === 200) {
      Logger.log(✅ GCS: ${newName});
    } else {
      Logger.log(⚠️ GCS upload failed for ${newName}: ${uploadRes.getResponseCode()});
    }

    // Save into the specified Drive folder
    try {
      driveFolder.createFile(pdfBlob);  // Creates the PDF inside folder by ID :contentReference[oaicite:1]{index=1}
      Logger.log(📂 Drive: saved ${newName} into folder ID ${folderId});
    } catch (e) {
      Logger.log(⚠️ Drive save failed for ${newName}: ${e});
    }
  });
}


/**
 * Searches Gmail for messages matching query, pulls down all PDF attachments,
 * and uploads them straight into your GCS input bucket.
 *
 * @param {string} query  Any valid Gmail search string (e.g. 'from:me has:attachment filename:pdf')
 */
function fetchPdfsFromGmailAndUpload(query) {
  const token       = ScriptApp.getOAuthToken();
  const bucket      = GCS_INPUT_BUCKET;       // invoicing-inputs
  const prefix      = GCS_INPUT_PREFIX || ''; // optional folder prefix
  const threads     = GmailApp.search(query);
  let uploadCount   = 0;

  threads.forEach(thread => {
    const msgs = thread.getMessages();
    msgs.forEach(msg => {
      msg.getAttachments().forEach(att => {
        if (att.getContentType() === MimeType.PDF) {
          const fileName = att.getName();
          const objectName = prefix ? ${prefix}/${fileName} : fileName;
          const uploadUrl  =
            https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o +
            ?uploadType=media&name=${encodeURIComponent(objectName)};

          const res = UrlFetchApp.fetch(uploadUrl, {
            method:      'post',
            contentType: att.getContentType(),
            headers:     { Authorization: 'Bearer ' + token },
            payload:     att.getBytes()
          });

          if (res.getResponseCode() === 200) {
            Logger.log(📥 Fetched & uploaded: gs://${bucket}/${objectName});
            uploadCount++;
          } else {
            Logger.log(⚠️ Upload failed for ${fileName}: ${res.getResponseCode()});
          }
        }
      });
    });
  });

  Logger.log(✅ Done. Total PDFs uploaded: ${uploadCount});
}


// HELPERS 

/**
 * Creates a GCS bucket if it doesn’t already exist.
 * Requires the Cloud Storage JSON API to be enabled in your project.
 *
 * @param {string} bucketName  The name of the bucket to create.
 */
function ensureBucket(bucketName) {
  const token = ScriptApp.getOAuthToken();
  const url = https://storage.googleapis.com/storage/v1/b?project=${YOUR_PROJECT_ID};
  const payload = JSON.stringify({ name: bucketName });
  const res = UrlFetchApp.fetch(url, {
    method:      'post',
    contentType: 'application/json',
    headers:     { Authorization: 'Bearer ' + token },
    payload
  });
  if (res.getResponseCode() === 409) {
    Logger.log(Bucket "${bucketName}" already exists.);
  } else if (res.getResponseCode() === 200) {
    Logger.log(Created bucket "${bucketName}".);
  } else {
    throw new Error(Failed to create bucket: ${res.getContentText()});
  }
}

/**
 * Empties (deletes all objects) and then deletes the specified GCS bucket.
 *
 * @param {string} bucketName  The name of the bucket to remove.
 */
function deleteBucketAndContents(bucketName) {
  const token = ScriptApp.getOAuthToken();
  
  // 1) List all objects in the bucket
  const listUrl = https://storage.googleapis.com/storage/v1/b/${bucketName}/o;
  const listRes = UrlFetchApp.fetch(listUrl, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (listRes.getResponseCode() !== 200) {
    throw new Error(Failed to list objects in ${bucketName}: ${listRes.getContentText()});
  }
  const items = JSON.parse(listRes.getContentText()).items || [];
  
  // 2) Delete each object
  items.forEach(obj => {
    const deleteObjUrl =
      https://storage.googleapis.com/storage/v1/b/${bucketName}/o/ +
      encodeURIComponent(obj.name);
    const delRes = UrlFetchApp.fetch(deleteObjUrl, {
      method: 'delete',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (delRes.getResponseCode() !== 204) {
      Logger.log(⚠️ Could not delete object ${obj.name}: ${delRes.getResponseCode()});
    } else {
      Logger.log(Deleted object: ${obj.name});
    }
  });
  
  // 3) Delete the now‑empty bucket
  const deleteBucketUrl = https://storage.googleapis.com/storage/v1/b/${bucketName};
  const bucketRes = UrlFetchApp.fetch(deleteBucketUrl, {
    method: 'delete',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (bucketRes.getResponseCode() === 204) {
    Logger.log(✅ Bucket "${bucketName}" deleted successfully.);
  } else {
    throw new Error(Failed to delete bucket ${bucketName}: ${bucketRes.getContentText()});
  }
}


//////////////// EXECUTE LEVEL ////////////////

// Call this once at the start of your pipeline:
function setupBuckets() {
  ensureBucket(GCS_INPUT_BUCKET);
  ensureBucket(GCS_OUTPUT_BUCKET);
}

function callFetch() {
  const includedTo = [
    'sdes.orders@scidevltd.com', 
    'Janitzi.Moreno@scidevltd.com'
  ];
  const excludedTo = [
    'lisa@sunbeltfinance.com',
    'steve.talamantes@mx6trucking.com',
    'charles.whitley@mx6trucking.com'
  ];
  
  // Build include and exclude strings
  const includeClause = includedTo
    .map(addr => (to:${addr} OR cc:${addr}))
    .join(' OR ');
  const excludeClause = excludedTo
    .map(addr => -to:${addr})
    .join(' ');
  
  // Combine inbox and sent searches
  const query = [
    (${includeClause}),         // include these recipients
    excludeClause,               // exclude these recipients
    'has:attachment',
    'filename:pdf',
    'newer_than:14d',
    '(in:sent OR in:inbox)'      // search both Sent and Inbox
  ].join(' ').trim();

  fetchPdfsFromGmailAndUpload(query); 
}


/**
 * ▶️ Main entrypoint: runs the full pipeline
 */
/**
 * Scans each PDF’s OCR text and returns a map:
 *   { "Statement 235.pdf": ["5583-6","SO55919"], ... }
 */
function scanFolderPdfsForNumbers() {
  // Kick off per‑PDF OCR jobs
  const jobs = startVisionOcr();           
  jobs.forEach(job => waitForVisionOperation(job.opName));

  // Build a map of pdfName → [foundLabels]
  const found = {};
  jobs.forEach(({ pdfName, base }) => {
    const outputs = listGcsObjects(GCS_OUTPUT_BUCKET, base);
    if (!outputs.length) {
      Logger.log(⚠️ No OCR output for ${pdfName});
      return;
    }
    let fullText = '';
    outputs.forEach(o => {
      const data = JSON.parse(getGcsObjectText(GCS_OUTPUT_BUCKET, o.name));
      (data.responses || []).forEach(r => {
        if (r.fullTextAnnotation?.text) {
          fullText += r.fullTextAnnotation.text + ' ';
        }
      });
    });
    NUMBERS_TO_FIND.forEach(label => {
      if (fullText.includes(label)) {
        found[pdfName] = found[pdfName] || [];
        if (!found[pdfName].includes(label)) {
          found[pdfName].push(label);
          Logger.log(✔ ${pdfName}: found "${label}");
        }
      }
    });
  });

  Logger.log('✅ OCR Summary: ' + JSON.stringify(found, null, 2));  

  // Invert into label→ [key,…]
  const labelToKeys = {};
  Object.entries(FOLDER_KEY_MAP).forEach(([key, labels]) => {
    labels.forEach(lbl => {
      labelToKeys[lbl] = labelToKeys[lbl] || [];
      labelToKeys[lbl].push(key);
    });
  });

  // Parent Drive folder where your sub‑folders live
  const parentFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const token        = ScriptApp.getOAuthToken();

  // For each matched PDF, fetch the blob and save into each key’s sub‑folder
  Object.entries(found).forEach(([pdfName, labels]) => {
    // Fetch PDF from your input bucket
    const resp = UrlFetchApp.fetch(
      https://storage.googleapis.com/storage/v1/b/${GCS_INPUT_BUCKET}/o/ +
      encodeURIComponent(pdfName) + ?alt=media,
      { headers: { Authorization: Bearer ${token} }}
    );
    if (resp.getResponseCode() !== 200) {
      Logger.log(⚠️ Could not fetch PDF ${pdfName}: ${resp.getResponseCode()});
      return;
    }
    const pdfBlob = resp.getBlob().setName(pdfName);

    // For each label found in that PDF…
    labels.forEach(label => {
      const keys = labelToKeys[label] || [];
      keys.forEach(key => {
        // Find or create the matching sub‑folder under parentFolder
        let target = null;
        const subs = parentFolder.getFolders();
        while (subs.hasNext()) {
          const f = subs.next();
          if (f.getName().indexOf(key) !== -1) {
            target = f;
            break;
          }
        }
        if (!target) {
          target = parentFolder.createFolder(key);
        }

        // Save the PDF into that sub‑folder
        target.createFile(pdfBlob);
        Logger.log(📂 Saved ${pdfName} (label="${label}") → folder "${target.getName()}");
      });
    });
  });

  return found;
}



/**
 * Convenience: Delete both your configured input & output buckets.
 */
function clearAndDeleteAllBuckets() {
  deleteBucketAndContents(GCS_INPUT_BUCKET);
  deleteBucketAndContents(GCS_OUTPUT_BUCKET);
}