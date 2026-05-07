# Simple HTTP Server for Vite build
$ErrorActionPreference = "SilentlyContinue"

function Get-FileMimeType($extension) {
    $mimeTypes = @{
        ".html" = "text/html"
        ".js" = "application/javascript"
        ".css" = "text/css"
        ".json" = "application/json"
        ".png" = "image/png"
        ".jpg" = "image/jpeg"
        ".jpeg" = "image/jpeg"
        ".gif" = "image/gif"
        ".svg" = "image/svg+xml"
    }
    return $mimeTypes[$extension]
}

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$distPath = Join-Path $scriptPath "dist"
$port = 5173

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()

Write-Host "Server running at http://localhost:$port/"
Write-Host "Press Ctrl+C to stop"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContextAsync()
        $context.Wait()
        
        $request = $context.Result
        $response = $context.Result.Response
        
        $urlPath = $request.Url.LocalPath
        if ($urlPath -eq "/") { $urlPath = "/index.html" }
        
        $filePath = Join-Path $distPath $urlPath
        
        if (Test-Path $filePath) {
            $ext = [System.IO.Path]::GetExtension($filePath)
            $contentType = Get-FileMimeType $ext
            if (-not $contentType) { $contentType = "application/octet-stream" }
            
            $content = Get-Content $filePath -Raw -Encoding Byte
            $response.Headers.Add("Content-Type", $contentType)
            $response.StatusCode = 200
            $response.ContentLength64 = $content.Length
            $response.OutputStream.Write($content, 0, $content.Length)
        } else {
            $response.StatusCode = 404
        }
        
        $response.Close()
    }
} catch {
    Write-Host "Server stopped"
} finally {
    $listener.Stop()
}