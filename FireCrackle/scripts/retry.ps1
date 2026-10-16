# Run an action again when it fails (a flaky download), waiting longer each time; the last failure is thrown.
function Invoke-WithRetry {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][scriptblock]$Action,
        [int]$Attempts = 4,
        [double]$DelaySeconds = 5,
        [scriptblock]$Sleep = { param($seconds) Start-Sleep -Seconds $seconds }
    )
    if ($Attempts -lt 1) { throw 'Attempts must be at least 1.' }
    $delay = $DelaySeconds
    for ($attempt = 1; ; $attempt++) {
        try { return & $Action }
        catch {
            if ($attempt -ge $Attempts) { throw }
            Write-Warning "Attempt $attempt of $Attempts failed: $($_.Exception.Message) Retrying in $delay s."
            & $Sleep $delay
            $delay = $delay * 2
        }
    }
}
