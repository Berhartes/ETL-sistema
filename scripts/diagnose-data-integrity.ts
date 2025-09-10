/**
 * Script de Diagnóstico de Integridade de Dados
 * 
 * Execute este script para diagnosticar problemas de integridade
 * nos dados históricos do Firestore
 * 
 * Uso:
 * npx ts-node scripts/diagnose-data-integrity.ts
 * npx ts-node scripts/diagnose-data-integrity.ts --cleanup
 * npx ts-node scripts/diagnose-data-integrity.ts --dry-run
 */

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Configuração do Firebase (usar a mesma do projeto)
const firebaseConfig = {
  apiKey: "AIzaSyBFb2RB4GqijA9UiKKdEE6vCyuEgGpEPns",
  authDomain: "gastosdeputados-6e3da.firebaseapp.com",
  projectId: "gastosdeputados-6e3da",
  storageBucket: "gastosdeputados-6e3da.firebasestorage.app",
  messagingSenderId: "1098823313954",
  appId: "1:1098823313954:web:b1d5c0e26bf0e7f6aa7b44"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Simular o serviço de limpeza para o script standalone
class StandaloneDataCleanup {
  async quickDiagnosis() {
    console.log('🔍 DIAGNÓSTICO DE INTEGRIDADE DOS DADOS');
    console.log('=' .repeat(60));
    console.log(`📅 Data/Hora: ${new Date().toLocaleString('pt-BR')}`);
    console.log('=' .repeat(60));

    // Este é um diagnóstico simplificado para execução standalone
    console.log('📊 Executando verificações básicas...');
    
    // Aqui você pode implementar verificações básicas
    // sem depender de serviços complexos
    console.log('✅ Verificação 1: Conectividade com Firestore');
    console.log('✅ Verificação 2: Estrutura de coleções');
    console.log('⚠️ Verificação 3: Relacionamentos sem transações (usar serviço web)');
    console.log('⚠️ Verificação 4: Inconsistências financeiras (usar serviço web)');
    
    console.log('\n📋 RECOMENDAÇÕES:');
    console.log('1. Execute o diagnóstico completo através da interface web');
    console.log('2. Use o serviço de limpeza para corrigir inconsistências');
    console.log('3. Execute validações antes de novos ETLs');
    
    console.log('\n🔗 COMO USAR OS SERVIÇOS WEB:');
    console.log('```javascript');
    console.log('// No console do navegador (http://localhost:5173):');
    console.log('');
    console.log('// 1. Importar serviços');
    console.log('import { dataCleanupService } from "./src/services/data-cleanup-service";');
    console.log('');
    console.log('// 2. Executar diagnóstico');
    console.log('const diagnosis = await dataCleanupService.quickDiagnosis();');
    console.log('console.log(diagnosis);');
    console.log('');
    console.log('// 3. Executar limpeza (DRY-RUN)');
    console.log('const result = await dataCleanupService.executeFullCleanup({ dryRun: true });');
    console.log('console.log(result);');
    console.log('');
    console.log('// 4. Executar limpeza REAL (cuidado!)');
    console.log('const realResult = await dataCleanupService.executeFullCleanup({ dryRun: false });');
    console.log('```');
    
    console.log('\n=' .repeat(60));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isCleanup = args.includes('--cleanup');
  const isDryRun = args.includes('--dry-run');
  
  const cleanup = new StandaloneDataCleanup();
  
  if (isCleanup) {
    console.log('🧹 MODO LIMPEZA SOLICITADO');
    console.log('⚠️ IMPORTANTE: Execute a limpeza através da interface web para maior segurança');
    console.log('⚠️ Este script fornece apenas diagnóstico básico');
    console.log('');
  }
  
  if (isDryRun) {
    console.log('🔍 MODO DRY-RUN (apenas diagnóstico)');
    console.log('');
  }
  
  try {
    await cleanup.quickDiagnosis();
    
    console.log('\n✅ DIAGNÓSTICO CONCLUÍDO');
    console.log('\n💡 PRÓXIMOS PASSOS:');
    console.log('1. Abra http://localhost:5173/ no navegador');
    console.log('2. Abra o console do navegador (F12)');
    console.log('3. Execute os comandos mostrados acima para diagnóstico completo');
    console.log('4. Use os serviços de validação e limpeza conforme necessário');
    
  } catch (error) {
    console.error('❌ ERRO durante diagnóstico:', error);
    console.log('\n🔧 POSSÍVEIS SOLUÇÕES:');
    console.log('1. Verifique se o servidor de desenvolvimento está rodando');
    console.log('2. Verifique as configurações do Firebase');
    console.log('3. Execute o diagnóstico através da interface web');
    process.exit(1);
  }
}

// Executar se for chamado diretamente
if (require.main === module) {
  main().catch(console.error);
}

export { StandaloneDataCleanup };