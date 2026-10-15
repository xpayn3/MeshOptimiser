' Starts MeshOptimiser with no console window: the Desktop and Start-menu
' shortcuts point here. The program lives in the app folder; this file only
' hands over to app\start_hidden.vbs, which decides whether a window is needed.
Option Explicit
Dim sh, fso, here
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here & "\app"
sh.Run "wscript.exe """ & here & "\app\start_hidden.vbs""", 0, False
