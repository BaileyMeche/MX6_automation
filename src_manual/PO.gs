/**
 * Configuration
 */
const PROJECT_ID            = ''
const PO_BUCKET_NAME        = '';
const EMAIL_SENDER          = '';
const ATTACH_KEYWORD        = '';
const DOWNLOAD_FOLDER_ID    = '';   // ← replace with your target Drive folder ID


// In-memory storage of PO → total mappings
let poTotals = {};

/**
 * Ensures the GCS bucket exists.
 */
function ensureBucket(bucketName) {
  const token = ScriptApp.getOAuthToken();
  const url   = `https://storage.googleapis.com/storage/v1/b?project=${PROJECT_ID}`;
  const res   = UrlFetchApp.fetch(url, {
    method:      'post',
    contentType: 'application/json',
    headers:     { Authorization: 'Bearer ' + token },
    payload:     JSON.stringify({ name: bucketName }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code === 200 || code === 201) {
    Logger.log(`Bucket '${bucketName}' created successfully.`);
  } else if (code === 409) {
    Logger.log(`Bucket '${bucketName}' already exists.`);
  } else {
    throw new Error(`Bucket creation failed (${code}): ${res.getContentText()}`);
  }
}

/**
 * Extracts text from a PDF blob by converting it to Google Docs.
 * Requires Drive API enabled in Advanced Services.
 */
function extractTextFromPdf(pdfBlob) {
  const resource = {
    title:    pdfBlob.getName(),
    mimeType: MimeType.GOOGLE_DOCS
  };
  const file = Drive.Files.insert(resource, pdfBlob, { convert: true });
  const text = DocumentApp.openById(file.id).getBody().getText();
  Drive.Files.remove(file.id);
  return text;
}

/**
 * Main workflow:
 * 1. Upload/filter PO PDFs
 * 2. Parse out TOTAL amounts into poTotals
 * 3. Download all PO PDFs to Drive
 * 4. Print status via get_PO_status()
 */
function processPurchaseOrders() {
  ensureBucket(PO_BUCKET_NAME);
  poTotals = {};      // reset any previous run
  const pdfNames = [];
  const token    = ScriptApp.getOAuthToken();

  // 1) Find & upload
  const threads = GmailApp.search(`from:${EMAIL_SENDER} 'newer_than:14d' filename:pdf ${ATTACH_KEYWORD}`);
  threads.forEach(thread =>
    thread.getMessages().forEach(msg => {
      const subjMatch = msg.getSubject().match(/\b(PO\d+)\b/i);
      if (!subjMatch) return;
      const poNumber = subjMatch[1];

      msg.getAttachments({ includeInlineImages: false })
         .filter(att => att.getName().includes(ATTACH_KEYWORD))
         .forEach(att => {
           const newName = `${poNumber}.pdf`;
           pdfNames.push(newName);

           // upload
           const uploadUrl =
             `https://storage.googleapis.com/upload/storage/v1/b/${PO_BUCKET_NAME}/o`
             + `?uploadType=media&name=${encodeURIComponent(newName)}`;
           UrlFetchApp.fetch(uploadUrl, {
             method:      'post',
             contentType: 'application/pdf',
             headers:     { Authorization: 'Bearer ' + token },
             payload:      att.getBytes(),
             muteHttpExceptions: true
           });
           Logger.log(`Uploaded ${newName}`);

           // parse total
           const text = extractTextFromPdf(att);
           const m    = text.match(/TOTAL\s*\$([\d,]+\.\d{2})/i);
           poTotals[poNumber] = m ? `$${m[1]}` : 'N/A';
         });
    })
  );

  // 2) Download all uploaded PDFs into Drive
  const folder = DriveApp.getFolderById(DOWNLOAD_FOLDER_ID);
  pdfNames.forEach(fileName => {
    const dlUrl =
      `https://storage.googleapis.com/storage/v1/b/`
      + `${PO_BUCKET_NAME}/o/${encodeURIComponent(fileName)}?alt=media`;
    try {
      const resp = UrlFetchApp.fetch(dlUrl, {
        headers: { Authorization: 'Bearer ' + token }
      });
      folder.createFile(resp.getBlob().setName(fileName));
      Logger.log(`Downloaded ${fileName}`);
    } catch (e) {
      Logger.log(`Failed to download ${fileName}: ${e}`);
    }
  });

  // Persist mapping so it survives across runs
  PropertiesService.getScriptProperties().setProperty(
    'POTotals',
    JSON.stringify(poTotals)
  );

  // 3) Print status
  get_PO_status();
}

/**
 * Helper: Logs each PO number alongside its parsed dollar total.
 * Can be called anytime after processPurchaseOrders() has populated poTotals.
 */
function get_PO_status() {
  const raw = PropertiesService.getScriptProperties().getProperty('POTotals');
  if (!raw) {
    Logger.log('No PO data available. Have you run processPurchaseOrders()?');
    return;
  }
  const stored = JSON.parse(raw);
  for (const po in stored) {
    Logger.log(`${po} – ${stored[po]}`);
  }
}


function clearAndDeleteAllBuckets() {
  deleteBucketAndContents(PO_BUCKET_NAME);
}

