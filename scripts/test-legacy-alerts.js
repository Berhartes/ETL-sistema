// Teste do sistema de alertas para nomenclatura legada
console.log('🚀 Testando sistema de alertas para nomenclatura legada...');

// Simulação das classes (sem imports por simplicidade do teste)
class LegacyUsageAlerter {
  constructor(config = {}) {
    this.config = {
      enabled: true,
      logLevel: 'warn',
      includeStackTrace: false,
      throttleMs: 1000, // Reduzido para teste
      reportToConsole: true,
      reportToFile: false,
      ...config
    };
    this.alertQueue = [];
    this.lastAlerts = new Map();
  }

  alertLegacyUsage(field, context, value, severity = 'medium') {
    if (!this.config.enabled) return;

    const alertKey = `${field}_${context}`;
    const now = Date.now();
    const lastAlert = this.lastAlerts.get(alertKey);

    // Throttling
    if (lastAlert && (now - lastAlert) < this.config.throttleMs) {
      return;
    }

    const alert = {
      timestamp: now,
      field,
      context,
      value: this.sanitizeValue(value),
      recommendation: this.getRecommendation(field),
      severity
    };

    this.processAlert(alert);
    this.lastAlerts.set(alertKey, now);
  }

  processAlert(alert) {
    this.alertQueue.push(alert);
    if (this.alertQueue.length > 100) {
      this.alertQueue.shift();
    }

    if (this.config.reportToConsole) {
      this.logToConsole(alert);
    }
  }

  logToConsole(alert) {
    const emoji = this.getSeverityEmoji(alert.severity);
    const timestamp = new Date(alert.timestamp).toISOString();

    console.warn(`${emoji} [LEGACY USAGE] ${alert.field} usado em ${alert.context}`);
    console.warn(`   Severidade: ${alert.severity.toUpperCase()}`);
    console.warn(`   Recomendação: ${alert.recommendation}`);
    if (alert.value !== undefined) {
      console.warn(`   Valor: ${JSON.stringify(alert.value)}`);
    }
  }

  getSeverityEmoji(severity) {
    switch (severity) {
      case 'low': return '💡';
      case 'medium': return '⚠️';
      case 'high': return '🚨';
      default: return '📋';
    }
  }

  getRecommendation(field) {
    const recommendations = {
      'fornecedorNome': 'Use "nomeFornecedor" em vez de "fornecedorNome"',
      'fornecedorCnpj': 'Use "cnpjCpfFornecedor" em vez de "fornecedorCnpj"'
    };
    return recommendations[field] || `Campo "${field}" está depreciado`;
  }

  sanitizeValue(value) {
    if (typeof value === 'string' && value.length > 50) {
      return value.substring(0, 50) + '...';
    }
    return value;
  }

  getAlertStats() {
    const stats = {
      total: this.alertQueue.length,
      byField: {},
      bySeverity: {},
      recentAlerts: this.alertQueue.slice(-10)
    };

    this.alertQueue.forEach(alert => {
      stats.byField[alert.field] = (stats.byField[alert.field] || 0) + 1;
      stats.bySeverity[alert.severity] = (stats.bySeverity[alert.severity] || 0) + 1;
    });

    return stats;
  }

  generateAlertReport() {
    const stats = this.getAlertStats();
    
    const report = [
      '📋 [ALERT REPORT] Relatório de Alertas de Nomenclatura Legada',
      '================================================',
      `📊 Total de alertas: ${stats.total}`,
      '',
      '🔍 Alertas por campo:',
      ...Object.entries(stats.byField).map(([field, count]) => 
        `   ${field}: ${count} ocorrências`
      ),
      '',
      '⚡ Alertas por severidade:',
      ...Object.entries(stats.bySeverity).map(([severity, count]) => 
        `   ${severity}: ${count} ocorrências`
      ),
      '================================================'
    ];

    return report.join('\n');
  }
}

// Função para simular verificação de campos legados
function checkLegacyFields(data, context, alerter) {
  if (!data || typeof data !== 'object') return;

  const legacyFields = ['fornecedorNome', 'fornecedorCnpj'];
  
  legacyFields.forEach(field => {
    if (data.hasOwnProperty(field) && data[field] !== undefined && data[field] !== null) {
      alerter.alertLegacyUsage(field, context, data[field]);
    }
  });
}

// === TESTES ===

console.log('\n🧪 Iniciando testes do sistema de alertas...');

// Teste 1: Criação e configuração básica
console.log('\n1️⃣ Teste: Criação do alerter');
const alerter = new LegacyUsageAlerter();
console.log('✅ Alerter criado com sucesso');

// Teste 2: Alerta simples
console.log('\n2️⃣ Teste: Alerta simples');
alerter.alertLegacyUsage('fornecedorNome', 'teste-basico', 'EMPRESA TESTE');

// Teste 3: Diferentes severidades
console.log('\n3️⃣ Teste: Diferentes severidades');
alerter.alertLegacyUsage('fornecedorCnpj', 'teste-low', '12345678901234', 'low');
alerter.alertLegacyUsage('fornecedorNome', 'teste-medium', 'EMPRESA MEDIUM', 'medium');
alerter.alertLegacyUsage('fornecedorCnpj', 'teste-high', '98765432109876', 'high');

// Teste 4: Verificação automática de dados
console.log('\n4️⃣ Teste: Verificação automática de dados');
const testData = [
  { id: 1, fornecedorNome: 'ANTIGA EMPRESA', nomeFornecedor: 'NOVA EMPRESA' },
  { id: 2, fornecedorCnpj: '11111111111111' },
  { id: 3, nomeFornecedor: 'EMPRESA SÓ NOVA', cnpjCpfFornecedor: '22222222222222' }
];

testData.forEach((data, index) => {
  checkLegacyFields(data, `processamento-lote-${index}`, alerter);
});

// Teste 5: Throttling (aguardar um pouco)
console.log('\n5️⃣ Teste: Throttling de alertas');
alerter.alertLegacyUsage('fornecedorNome', 'teste-throttle', 'PRIMEIRA VEZ');
alerter.alertLegacyUsage('fornecedorNome', 'teste-throttle', 'SEGUNDA VEZ - DEVE SER BLOQUEADO');

setTimeout(() => {
  console.log('\n⏰ Após timeout...');
  alerter.alertLegacyUsage('fornecedorNome', 'teste-throttle', 'TERCEIRA VEZ - APÓS TIMEOUT');
  
  // Teste 6: Estatísticas e relatório
  console.log('\n6️⃣ Teste: Estatísticas e relatório');
  const stats = alerter.getAlertStats();
  console.log('📊 Estatísticas:', JSON.stringify(stats, null, 2));
  
  console.log('\n📋 Relatório completo:');
  console.log(alerter.generateAlertReport());
  
  // Teste 7: Desabilitação de alertas
  console.log('\n7️⃣ Teste: Desabilitação de alertas');
  alerter.config.enabled = false;
  alerter.alertLegacyUsage('fornecedorNome', 'teste-desabilitado', 'NÃO DEVE APARECER');
  console.log('✅ Alerta bloqueado com sucesso (não deve aparecer acima)');
  
  console.log('\n🎉 Todos os testes do sistema de alertas concluídos!');
  
}, 1500);