#!/bin/bash
# 🧹 Limpeza Final - Remove TODOS os arquivos ETL redundantes
# 
# Deixa apenas os 3 arquivos da arquitetura core

echo "🧹 LIMPEZA FINAL - ETL"
echo "════════════════════════════════════════"
echo ""

# Criar backup com timestamp
BACKUP_DIR="./archived/final-cleanup-$(date +%Y%m%d-%H%M%S)"
echo "📦 Criando backup final em: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

# Lista de TODOS os arquivos redundantes identificados
REDUNDANT_FILES=(
    "run-etl.js"
    "run-etl-simple.js"
    "test-etl-migration.js"
    "connectivity-detector.js"
    "processar-offline.js"
    "etl-auto.js"
    "etl-smart-fallback.js"
    "simple-test.js"
    "test-simple-firestore.js"
    "test-firestore-connection.js"
    "network-doctor.js"
    "run-audit-test.js"
    "run-migration-analysis.js"
)

echo "🔍 Arquivos a serem movidos para backup:"

# Mover arquivos redundantes para backup
moved_count=0
for file in "${REDUNDANT_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "   📁 $file"
        mv "$file" "$BACKUP_DIR/"
        ((moved_count++))
    fi
done

echo ""
echo "✅ Limpeza concluída!"
echo "📊 Arquivos movidos: $moved_count"
echo "📂 Backup salvo em: $BACKUP_DIR"
echo ""

echo "🏗️ ARQUITETURA FINAL (3 arquivos):"
echo "   ✅ etl-despesas-real.js      (Extração)"
echo "   ✅ etl-inteligente.js        (Orquestração)"  
echo "   ✅ etl-firestore-integration.js (Persistência)"
echo ""

echo "🎯 COMANDOS DE USO:"
echo "   npm run etl:despesas -- 57 1 --firestore"
echo ""

echo "🔍 PRÓXIMO PASSO - RESOLVER CONECTIVIDADE:"
echo "   1. Desabilitar Firewall do Windows temporariamente"
echo "   2. Executar: npm run etl:despesas -- 57 1 --firestore"
echo "   3. Se funcionar → criar regra específica para node.exe"
echo "   4. Reabilitar firewall com exceção"
echo ""

echo "📋 Arquivos mantidos na raiz:"
ls -la etl-*.js test-connectivity.js 2>/dev/null | grep -v "total"
echo ""

echo "💡 Para restaurar: mv $BACKUP_DIR/arquivo.js ./"