# PowerShell script to batch-fix entity imports
$replacements = @{
    "import { Product } from '../product/entities/product.entity';" = "import { ProductDocument } from '../product/product-types';"
    "import { Product } from '../../product/entities/product.entity';" = "import { ProductDocument } from '../../product/product-types';"
    "import { Product } from '../../../product/entities/product.entity';" = "import { ProductDocument } from '../../../product/product-types';"
    
    "import { ProductTitle } from '../product/entities/product-title.entity';" = "import { ProductTitle } from '../product/product-types';"
    "import { ProductTitle } from '../../product/entities/product-title.entity';" = "import { ProductTitle } from '../../product/product-types';"
    
    "import { ProductCategory } from '../product/entities/product-category.entity';" = "import { ProductCategory } from '../product/product-types';"
    "import { ProductCategory } from '../../product/entities/product-category.entity';" = "import { ProductCategory } from '../../product/product-types';"
    
    "import { ProductCompatibility } from '../product/entities/product-compatibility.entity';" = "import { ProductCompatibilityDocument } from '../product/product-types';"
    "import { ProductCompatibility } from '../../product/entities/product-compatibility.entity';" = "import { ProductCompatibilityDocument } from '../../product/product-types';"
    
    "import { ProductMovement } from '../product/entities/product-movement.entity';" = "import { ProductMovement } from '../product/product-types';"
    "import { ProductMovement } from '../../product/entities/product-movement.entity';" = "import { ProductMovement } from '../../product/product-types';"
    
    "import { ProductDraft } from '../product/entities/product-draft.entity';" = "import { ProductDraft } from '../product/product-types';"
    
    "import { BoxItem } from '../product/entities/box-item.entity';" = "import { BoxItem } from '../product/product-types';"
    "import { Box Item } from '../../product/entities/box-item.entity';" = "import { BoxItem } from '../../product/product-types';"
    
    "import { ProductAllocation } from '../../product/entities/product-allocation.entity';" = "import { ProductAllocation } from '../../product/product-types';"
}

$files = Get-ChildItem -Path "src" -Recurse -Filter "*.ts" | Where-Object { 
    $_.FullName -notlike "*node_modules*" -and
    (Get-Content $_.FullName -Raw) -match "product/entities"
}

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $changed = $false
    
    foreach ($old in $replacements.Keys) {
        if ($content -match [regex]::Escape($old)) {
            $content = $content -replace [regex]::Escape($old), $replacements[$old]
            $changed = $true
        }
    }
    
    if ($changed) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        Write-Output "Updated: $($file.FullName)"
    }
}

Write-Output "Done!"
