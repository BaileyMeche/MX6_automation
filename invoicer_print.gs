
function batchPrint() {
  const DRIVE_FOLDER_ID     = '';
  const CELL_ID             = '';
  const CELL_ID_SECONDARY   = '';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('sheet_name');
  
  const parentFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const timestamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd_HHmmss');
  const outFolder = parentFolder.createFolder(`Prints_${timestamp}`);
  
  const startRow  = ;
  const endRow    = ;

  for (let row = startRow; row <= endRow; row++) {
    // Set H15 formula dynamically
    const formula = `=LoadList!A${row}`;
    sheet.getRange(CELL_ID).setFormula(formula);

    SpreadsheetApp.flush();
    Utilities.sleep(1000); // Wait for rendering

    // Fetch updated cell values after H15 updates
    const CELL_IDValue = sheet.getRange(CELL_ID).getDisplayValue();
    const CELL_ID_SECONDARYValue = sheet.getRange(CELL_ID_SECONDARY).getDisplayValue();

    // Construct filename based on formula logic
    const fileName = `${CELL_IDValue} ${CELL_ID_SECONDARYValue}m.pdf`;

    // Export and save
    const pdfBlob = generatePdfBlob(ss, sheet.getName()).setName(fileName);
    outFolder.createFile(pdfBlob);
  }
}

function generatePdfBlob(spreadsheet, sheetName) {
  const ssId = spreadsheet.getId();
  const sheet = spreadsheet.getSheetByName(sheetName);
  const gid = sheet.getSheetId();
  const url = `https://docs.google.com/spreadsheets/d/${ssId}/export?` +
              `format=pdf&portrait=true&size=letter&sheetnames=false&printtitle=false&` +
              `pagenumbers=false&gridlines=false&fzr=false&gid=${gid}`;

  const token = ScriptApp.getOAuthToken();
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.getBlob();
}
