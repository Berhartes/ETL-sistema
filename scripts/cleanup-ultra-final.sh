#!/bin/bash
# 🧹 LIMPEZA ULTRA FINAL - Remove TODOS os arquivos de debug/investigação
# 
# Deixa apenas os 3 arquivos ETL core + utilitários essenciais

echo "🧹 LIMPEZA ULTRA FINAL"
echo "════════════════════════════════════════"
echo ""

# Criar backup com timestamp
BACKUP_DIR="./archived/ultra-final-cleanup-$(date +%Y%m%d-%H%M%S)"
echo "📦 Criando backup ultra final em: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

echo "🔍 Movendo arquivos de debug e investigação..."

# Mover todos os arquivos debug-*
for file in debug-*.js debug-*.json; do
    if [ -f "$file" ]; then
        echo "   📁 $file"
        mv "$file" "$BACKUP_DIR/"
    fi
done

# Mover todos os arquivos investigar-*
for file in investigar-*.js investigar-*.cjs; do
    if [ -f "$file" ]; then
        echo "   📁 $file"
        mv "$file" "$BACKUP_DIR/"
    fi
done

# Mover arquivos específicos restantes
SPECIFIC_FILES=(
    "run-etl-processor.ts"
    "cleanup-etl-redundant.sh"
    "example-real-usage.cjs"
    "etl-auto.js"
    "test-etl-migration.js"
    "test-firestore-connection.js"
    "test-simple-firestore.js"
    "simple-test.js"
    "network-doctor.js"
)

for file in "${SPECIFIC_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "   📁 $file"
        mv "$file" "$BACKUP_DIR/"
    fi
done

echo ""
echo "✅ Limpeza ultra final concluída!"
echo ""

echo "🏗️ ARQUIVOS FINAIS MANTIDOS:"
echo "   Core ETL:"
echo "   ✅ etl-despesas-real.js"
echo "   ✅ etl-inteligente.js"  
echo "   ✅ etl-firestore-integration.js"
echo ""
echo "   Utilitários:"
echo "   ✅ test-connectivity.js"
echo "   ✅ cleanup-final.sh"
echo "   ✅ cleanup-ultra-final.sh"
echo ""

echo "📊 Estrutura final do projeto:"
ls -la etl-*.js test-connectivity.js cleanup-*.sh 2>/dev/null | grep -v "total"
echo ""

echo "🎯 COMANDO ÚNICO DE USO:"
echo "   npm run etl:despesas -- 57 1 --firestore"
echo ""

echo "🌐 PRÓXIMO PASSO - RESOLVER DNS:"
echo "   1. Win+R → ncpa.cpl"
echo "   2. Propriedades da conexão → TCP/IPv4 → Propriedades"
echo "   3. DNS: 8.8.8.8 e 8.8.4.4"
echo "   4. CMD: ipconfig /flushdns"
echo "   5. Reiniciar PC"
echo "   6. Testar: npm run etl:despesas -- 57 1 --firestore"
echo ""

moved_count=$(ls "$BACKUP_DIR" 2>/dev/null | wc -l)
echo "📂 Total de arquivos movidos: $moved_count"
echo "🗂️ Backup: $BACKUP_DIR"