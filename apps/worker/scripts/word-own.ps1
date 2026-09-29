# Which Word the Word check may drive (the final review of W15.1), dot-sourced by word-check.ps1 and
# held by src/word-own.test.ts. Word's COM server hands a new client the Word already running where
# there is one, and the check drives Word hidden: attached to a person's Word, it would hide their
# windows. So it refuses while any Word runs, and after asking COM for Word drives only a WINWORD
# process that was not there before it asked.

# Why the check will not start, given the WINWORD processes running now; or nothing, where none is.
function Get-WordRefusal([int[]]$Running) {
  if ($Running.Count -eq 0) { return $null }
  return ("Word is already running (process $($Running -join ', ')). Close it first: the Word check " +
    "runs a Word of its own, hidden, and will not take over or hide yours. A WINWORD process with no " +
    "window may be one an earlier check left; end it in Task Manager.")
}

# The one WINWORD process that was not running before COM was asked for Word, or nothing: where COM
# gave back a Word already running, or more than one appeared, the check does not know which is its own.
function Get-OwnWord([int[]]$Before, [int[]]$After) {
  $new = @($After | Where-Object { $Before -notcontains $_ })
  if ($new.Count -ne 1) { return $null }
  return $new[0]
}
