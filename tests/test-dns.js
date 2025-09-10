#!/usr/bin/env node
/**
 * 🌐 Teste de DNS Específico para Firestore
 * 
 * Testa especificamente a resolução DNS dos serviços Google Cloud
 */

import dns from 'dns';
import { promisify } from 'util';
import https from 'https';

const lookup = promisify(dns.lookup);
const resolve = promisify(dns.resolve);

// Endpoints críticos do Google Cloud/Firebase
const ENDPOINTS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com', 
  'googleapis.com',
  'accounts.google.com',
  'oauth2.googleapis.com'
];

async function testarDNS() {
  console.log('🌐 Teste de DNS - Google Cloud Services');
  console.log('═'.repeat(50));
  console.log('');

  // Verificar DNS atual
  console.log('🔍 Verificando configuração DNS atual...');
  try {
    const dnsServers = dns.getServers();
    console.log(`   DNS Servers: ${dnsServers.join(', ')}`);
    
    if (dnsServers.includes('8.8.8.8') || dnsServers.includes('1.1.1.1')) {
      console.log('   ✅ DNS público detectado');
    } else {
      console.log('   ⚠️ DNS do provedor/local detectado');
      console.log('   💡 Recomendação: Mudar para 8.8.8.8');
    }
    console.log('');
  } catch (error) {
    console.log(`   ❌ Erro ao verificar DNS: ${error.message}`);
  }

  // Testar resolução de cada endpoint
  console.log('🔍 Testando resolução DNS...');
  const resultados = [];
  
  for (const endpoint of ENDPOINTS) {
    try {
      const startTime = Date.now();
      const result = await lookup(endpoint);
      const tempo = Date.now() - startTime;
      
      console.log(`   ✅ ${endpoint} → ${result.address} (${tempo}ms)`);
      resultados.push({ endpoint, ip: result.address, tempo, sucesso: true });
      
    } catch (error) {
      console.log(`   ❌ ${endpoint} → FALHA: ${error.message}`);
      resultados.push({ endpoint, erro: error.message, sucesso: false });
    }
  }

  console.log('');

  // Teste de conectividade HTTP
  console.log('🔗 Testando conectividade HTTPS...');
  
  for (const endpoint of ['firestore.googleapis.com', 'googleapis.com']) {
    try {
      const startTime = Date.now();
      
      await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: endpoint,
          port: 443,
          path: '/',
          method: 'HEAD',
          timeout: 10000
        }, (res) => {
          const tempo = Date.now() - startTime;
          console.log(`   ✅ HTTPS ${endpoint} → ${res.statusCode} (${tempo}ms)`);
          resolve();
        });
        
        req.on('error', reject);
        req.on('timeout', () => reject(new Error('TIMEOUT')));
        req.end();
      });
      
    } catch (error) {
      console.log(`   ❌ HTTPS ${endpoint} → FALHA: ${error.message}`);
    }
  }

  console.log('');

  // Resumo e recomendações
  console.log('📊 RESUMO DO TESTE');
  console.log('═'.repeat(30));
  
  const sucessos = resultados.filter(r => r.sucesso).length;
  const falhas = resultados.filter(r => !r.sucesso).length;
  
  console.log(`✅ Resoluções bem-sucedidas: ${sucessos}/${ENDPOINTS.length}`);
  console.log(`❌ Falhas: ${falhas}/${ENDPOINTS.length}`);
  
  if (falhas === 0) {
    console.log('');
    console.log('🎉 DNS FUNCIONANDO PERFEITAMENTE!');
    console.log('💡 O problema pode ser de firewall/proxy, não DNS');
    console.log('   Próximo teste: node test-connectivity.js');
  } else {
    console.log('');
    console.log('⚠️ PROBLEMAS DE DNS DETECTADOS');
    console.log('💡 Recomendações:');
    console.log('   1. Mudar DNS para 8.8.8.8 e 8.8.4.4');
    console.log('   2. CMD: ipconfig /flushdns');
    console.log('   3. Reiniciar computador');
    console.log('   4. Testar novamente: node test-dns.js');
  }

  // Verificar latência
  const tempos = resultados.filter(r => r.sucesso && r.tempo).map(r => r.tempo);
  if (tempos.length > 0) {
    const tempoMedio = Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length);
    console.log('');
    console.log(`⏱️ Latência média de DNS: ${tempoMedio}ms`);
    
    if (tempoMedio > 1000) {
      console.log('⚠️ Latência alta detectada');
      console.log('💡 Considere mudar para DNS mais rápido (8.8.8.8 ou 1.1.1.1)');
    }
  }
}

// Executar teste
if (import.meta.url === `file://${process.argv[1]}`) {
  testarDNS()
    .then(() => {
      console.log('');
      console.log('✅ Teste de DNS concluído!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Erro no teste de DNS:', error.message);
      process.exit(1);
    });
}