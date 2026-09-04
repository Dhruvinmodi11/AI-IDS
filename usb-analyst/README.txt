Local Analyst (USB)
===================

Replaces KoboldCpp. Uses llama.cpp (llama-server) plus a business dashboard.

What you double-click
---------------------
  F:\Start Analyst.bat

Windows blocks USB AutoRun. There is no safe way to launch on insert.
Plug in the stick, then double-click that file. Leave the black window open.

First run
---------
Downloads the llama.cpp Vulkan build into F:\gemma\bin\llama (~30 MB).
Loads the GGUF already at F:\gemma\models\ (Gemma 3n E4B IT Q4).
Opens http://127.0.0.1:8050

Use
---
1. Drop CSV / TSV / JSON / TXT (for Excel: Save As CSV).
2. KPIs and charts are calculated in the browser (use these totals).
3. Ask questions or click "Write executive brief".
4. Close the PowerShell window when finished, then Eject the USB.

Install onto the stick (from this folder)
-----------------------------------------
  powershell -ExecutionPolicy Bypass -File .\Install-ToUsb.ps1 -Drive F:

Do not put payroll, bank, or Aadhaar files into a git repo.
