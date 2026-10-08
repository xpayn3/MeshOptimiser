' Launches start.bat with no console window. Used by the .lnk shortcut so
' double-clicking it opens the app silently (server + app window only). Run
' start.bat directly when you want to see setup output or error logs.
'
' Nobody can answer a window that is not shown, so:
'  - the first run (no .venv yet), which asks questions and takes minutes,
'    gets an ordinary window;
'  - a hidden run tells start.bat that it is hidden (MESHOPTIMISER_HIDDEN).
'    start.bat then skips every "press a key" stop instead of waiting there
'    for good, and a failure is reported here, from its exit code.
Option Explicit
Dim WshShell, fso, scriptDir, batPath, rc
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = scriptDir & "\start.bat"
WshShell.CurrentDirectory = scriptDir
If Not fso.FileExists(scriptDir & "\.venv\Scripts\python.exe") Then
  ' Args: command, windowStyle (1 = normal window), waitForReturn (False = fire-and-forget)
  WshShell.Run """" & batPath & """", 1, False
Else
  WshShell.Environment("Process")("MESHOPTIMISER_HIDDEN") = "1"
  ' windowStyle 0 = hidden. Waiting for it to end is what gives the exit code;
  ' it ends when the app is closed.
  rc = WshShell.Run("""" & batPath & """", 0, True)
  If rc <> 0 Then
    MsgBox "MeshOptimiser stopped with an error (code " & rc & ")." & vbCrLf & vbCrLf & _
           "Double-click start.bat to see what went wrong.", vbExclamation, "MeshOptimiser"
  End If
End If
