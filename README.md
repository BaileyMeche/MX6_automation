# ETL Automation – Invoicer + OCR Vision

Automates an invoice generation and OCR-based text extraction pipeline using Google Apps Script, Google Sheets, Drive, and Cloud Vision/Storage.

## Overview

* **`invoicer_print.gs`**
  Iterates over rows in a Google Sheet (“Invoicer”), builds PDF invoices via Cloud export, and saves them to a preset Drive folder.

* **`read_pair.gs`**
  Loads those PDFs into a Cloud Storage bucket, runs Cloud Vision OCR, and looks for text strings defined in `NUMBERS_TO_FIND`. Produces pairs mapping found strings → PDF file names.

* **`appsscript.json`**
  Manifest file declaring all OAuth scopes needed to access spreadsheets, Drive, GCS/upload, external APIs, and Vision OCR REST calls.

##  Setup & Deployment

1. Create or open the target Google Sheet.
2. Go to **Extensions → Apps Script**, paste in the `.gs` files, and add the manifest.
3. Enable "Show appsscript.json" in Project Settings.
4. Set folder ID in script properties or code (`DRIVE_FOLDER_ID`).
5. Enable Cloud Vision API & Cloud Storage, attach a GCP project in **Project Settings** 
6. Set up a Cloud Storage bucket.
7. Deploy the script.


## Summary

This project:

* Loops through a sheet → exports PDFs → saves to Drive.
* Uploads each PDF to GCS → OCR scans via Vision → searches for target strings.
* Must be authorized with appropriate Drive, Sheets, HTTP, and GCP scopes.
