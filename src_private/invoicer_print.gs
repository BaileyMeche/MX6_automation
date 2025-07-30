function batchPrintInvoices() {
  const DRIVE_FOLDER_ID     = '1JVjrY3AYnXEd2ysA2WATJp9r8kp3q5Jj';
  const CELL_ID             = 'H15';
  const CELL_ID_SECONDARY   = 'C19';

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Invoicer');
  const parentFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);

  const startRow = 463;
  const endRow   = 465;

  for (let row = startRow; row <= endRow; row++) {
    // 1️⃣ Update the invoice reference in H15
    sheet.getRange(CELL_ID).setFormula(=LoadList!A${row});
    SpreadsheetApp.flush();
    Utilities.sleep(3000);  // give the sheet time to recalc

    // 2️⃣ Read the two key values
    const invoiceRef = sheet.getRange(CELL_ID).getDisplayValue();
    const folderKey  = sheet.getRange(CELL_ID_SECONDARY).getDisplayValue();

    // 3️⃣ Build the PDF filename
    const fileName = Inv${invoiceRef} PO${folderKey}m.pdf;

    // 4️⃣ Generate the PDF blob
    const pdfBlob = generatePdfBlob(ss, sheet.getName()).setName(fileName);

    // 5️⃣ Find (or create) the sub‑folder matching folderKey
    let targetFolder;
    const subFolders = parentFolder.getFolders();
    while (subFolders.hasNext()) {
      const f = subFolders.next();
      if (f.getName().indexOf(folderKey) !== -1) {
        targetFolder = f;
        break;
      }
    }
    if (!targetFolder) {
      // if none exists, create one named exactly as the key
      targetFolder = parentFolder.createFolder(folderKey);
    }

    // 6️⃣ Save the PDF into that folder
    targetFolder.createFile(pdfBlob);
    Logger.log(✅ Saved ${fileName} into folder "${targetFolder.getName()}");
  }
}

function generatePdfBlob(spreadsheet, sheetName) {
  const ssId = spreadsheet.getId();
  const sheet = spreadsheet.getSheetByName(sheetName);
  const gid = sheet.getSheetId();
  const url = https://docs.google.com/spreadsheets/d/${ssId}/export? +
              format=pdf&portrait=true&size=letter&sheetnames=false&printtitle=false& +
              pagenumbers=false&gridlines=false&fzr=false&gid=${gid};

  const token = ScriptApp.getOAuthToken();
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: Bearer ${token} }
  });
  return response.getBlob();
}