# PowerShell script to systematically fix all Product type references
$files = @(
    "src\marketplace\services\marketplace-description.service.ts",
    "src\marketplace\services\marketplace-integration-helper.service.ts",
    "src\marketplace\adapters\amazon\amazon-product.adapter.ts",
    "src\marketplace\adapters\amazon\amazon.adapter.ts",
    "src\marketplace\adapters\mercado-livre\mercado-livre-product.adapter.ts",
    "src\marketplace\adapters\olx\olx-product.adapter.ts",
    "src\marketplace\adapters\shopee\shopee-product.adapter.ts",
    "src\marketplace\interfaces\marketplace-product-adapter.interface.ts"
)

foreach ($file in $files) {
    if (Test-Path $file) {
        $content = Get-Content $file -Raw
        # Replace Product with ProductDocument in type annotations
        $content = $content -replace 'product: Product[,\)]', 'product: ProductDocument,'        
        $content = $content -replace 'product: Product\)', 'product: ProductDocument)'
        $content = $content -replace ': Product\[', ': ProductDocument['
        $content = $content -replace '<Product>', '<ProductDocument>'
        Set-Content $file -Value $content -NoNew line
        Write-Output "Updated: $file"
    }
}

Write-Output "Completed Product type replacements"
