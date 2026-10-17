# 将 logo 图片的白色背景（与边缘连通区域）转为透明
Add-Type -AssemblyName System.Drawing

function Remove-WhiteBackground {
    param([string]$Path, [int]$Threshold = 235)

    $img = [System.Drawing.Image]::FromFile($Path)
    $bmp = New-Object System.Drawing.Bitmap($img)
    $img.Dispose()

    $w = $bmp.Width
    $h = $bmp.Height
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $bytes = New-Object byte[] ($data.Stride * $h)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)

    # 队列式泛洪填充：从四条边的近白像素开始，标记为透明
    $visited = New-Object bool[] ($w * $h)
    $queue = New-Object System.Collections.Generic.Queue[int]
    for ($x = 0; $x -lt $w; $x++) {
        $queue.Enqueue($x)
        $queue.Enqueue(($h - 1) * $w + $x)
    }
    for ($y = 0; $y -lt $h; $y++) {
        $queue.Enqueue($y * $w)
        $queue.Enqueue($y * $w + $w - 1)
    }

    while ($queue.Count -gt 0) {
        $idx = $queue.Dequeue()
        if ($idx -lt 0 -or $idx -ge $w * $h) { continue }
        if ($visited[$idx]) { continue }
        $visited[$idx] = $true
        $p = $idx * 4
        $r = $bytes[$p]; $g = $bytes[$p + 1]; $b = $bytes[$p + 2]
        # 近白判定
        if ($r -ge $Threshold -and $g -ge $Threshold -and $b -ge $Threshold) {
            $bytes[$p + 3] = 0   # alpha = 0
            $x = $idx % $w
            $y = [math]::Floor($idx / $w)
            if ($x -gt 0) { $queue.Enqueue($idx - 1) }
            if ($x -lt $w - 1) { $queue.Enqueue($idx + 1) }
            if ($y -gt 0) { $queue.Enqueue($idx - $w) }
            if ($y -lt $h - 1) { $queue.Enqueue($idx + $w) }
        }
    }

    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
    $bmp.UnlockBits($data)
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "done: $Path"
}

Remove-WhiteBackground -Path "d:\coding\nodo\src\assets\logo.png"
Remove-WhiteBackground -Path "d:\coding\nodo\src\assets\logo_small.png"
Remove-WhiteBackground -Path "d:\coding\nodo\src\assets\logo-full.png"
Remove-WhiteBackground -Path "d:\coding\nodo\src\assets\logo-full-small.png"
