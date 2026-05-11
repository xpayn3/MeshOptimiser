' Launches start.bat with no console window. Used by the .lnk shortcut so
' double-clicking it opens the app silently (server + browser only). Run
' start.bat directly when you want to see setup output or error logs.
Option Explicit
Dim WshShell, fso, scriptDir, batPath
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = scriptDir & "\start.bat"
WshShell.CurrentDirectory = scriptDir
' Args: command, windowStyle (0 = hidden), waitForReturn (False = fire-and-forget)
WshShell.Run """" & batPath & """", 0, False
