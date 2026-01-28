#!/bin/bash

# Find all TypeScript files with relative imports missing .js extension
# This helps identify ALL files that need to be fixed for ESM

echo "🔍 Scanning for imports missing .js extensions..."
echo ""
echo "Files with potential issues:"
echo "=============================="

# Find imports from './' or '../' without .js extension
# Excludes: node_modules, .d.ts files, and already correct .js imports

grep -rn \
  --include="*.ts" \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude="*.d.ts" \
  -E "from ['\"]\.\.?/[^'\"]*(?<!\.js)['\"]" \
  src/ | \
  grep -v "\.js['\"]" | \
  grep -v "^Binary" | \
  sort

echo ""
echo "=============================="
echo ""
echo "Also checking import statements (side-effects):"
echo "=============================="

grep -rn \
  --include="*.ts" \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude="*.d.ts" \
  -E "^import ['\"]\.\.?/[^'\"]*(?<!\.js)['\"]" \
  src/ | \
  grep -v "\.js['\"]" | \
  grep -v "^Binary" | \
  sort

echo ""
echo "=============================="
echo "✅ Scan complete!"
echo ""
echo "How to fix:"
echo "1. Add .js extension to all relative imports shown above"
echo "2. Example: from './database' → from './database.js'"
echo "3. Rebuild: npm run build"
echo "4. Start: npm start"