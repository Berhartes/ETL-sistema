#!/usr/bin/env node
/**
 * 🔥 ETL FIRESTORE INTEGRATION - Integração Real com Firebase
 *
 * Módulo para integração real com Firestore, salvando os dados processados
 * no banco de dados Firebase com batching otimizado e tratamento de erros.
 * 
 * ✅ INTEGRAÇÃO REAL com Firestore
 * ✅ BATCH WRITING otimizado para performance
 * ✅ TRATAMENTO DE ERROS robusto
 * ✅ RETRY AUTOMÁTICO em caso de falhas
 * ✅ PROGRESS TRACKING em tempo real
 */

// Carregar variáveis de ambiente do arquivo .env
import dotenv from 'dotenv';
dotenv.config();

// Usar Firebase Admin SDK para operações ETL com permissões adequadas
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

// ✅ PADRÃO SINGLETON: Garante que a inicialização ocorra apenas uma vez.
let db = null;

function initializeFirestoreSingleton() {
  // Permite forçar o uso do fallback REST para testes/ambiente com gRPC bloqueado
  if (process.env.FIRESTORE_FORCE_REST === 'true') {
    console.log('⚠️ FIRESTORE_FORCE_REST=true -> Pulando inicialização do Admin SDK (usar apenas REST)');
    return null;
  }
  // Se já existe uma app inicializada, não faz nada para evitar recriação.
  if (getApps().length) {
    if (!db) db = getFirestore();
    return db; // Retorna a instância existente
  }

  try {
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './config/serviceAccountKey.json';
    const serviceAccountKey = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

    const app = getApps().length
      ? getApps()[0]
      : initializeApp({
      credential: cert(serviceAccountKey)
    });

    db = getFirestore(app);
    console.log('🔧 Configurando Firebase Admin SDK (Singleton)...');

    // Aplica as configurações essenciais UMA ÚNICA VEZ.
    db.settings({
      ignoreUndefinedProperties: true,
      timestampsInSnapshots: true
    });

    console.log(`   ✅ Service Account: ${serviceAccountKey.client_email}`);
    console.log(`   ✅ Project ID: ${serviceAccountKey.project_id}`);
    console.log('✅ Firestore Admin conectado com permissões de escrita.');
    return db;
  } catch (error) {
    console.warn('⚠️ Firebase Admin não disponível:', error.message);
    console.log('📋 Simulando operações Firestore...');
    return null; // Retorna null em caso de falha
  }
}

// Configurações de performance otimizadas para resolver DEADLINE_EXCEEDED
const BATCH_SIZE_INITIAL = 100; // Reduzido de 250 para 100 - mais conservador
const BATCH_SIZE_CONSERVATIVE = 50; // Reduzido de 100 para 50
const BATCH_SIZE_MINIMAL = 10; // Reduzido de 25 para 10 - muito mais conservador
const MAX_RETRIES = 5; // Mantido
const RETRY_DELAY_BASE = 3000; // Aumentado de 2s para 3s - mais tempo entre retries
const MAX_TIMEOUT_MS = 60000; // Reduzido de 5min para 1min - detecta problemas mais rápido
const CONNECTIVITY_TEST_TIMEOUT = 10000; // Mantido

// Inicializa a instância do Firestore ao carregar o módulo.
initializeFirestoreSingleton();

class FirestoreETLIntegration {
  constructor(connectivityConfig = null, dbInstance = null) {
    this.batchCount = 0;
    this.documentsWritten = 0;
    this.errors = [];
    this.successfulBatches = 0;
    this.failedBatches = 0;
    this.adaptiveBatchSize = BATCH_SIZE_INITIAL;
    this.currentTimeout = MAX_TIMEOUT_MS;
    this.connectivityConfig = connectivityConfig;
    this.db = dbInstance || db; // Usa a instância passada ou a global
  // Forçar uso do fallback REST quando variável de ambiente for true
  this.forceRest = process.env.FIRESTORE_FORCE_REST === 'true';
  if (this.forceRest) console.log('⚠️ FIRESTORE_FORCE_REST detectado na instância -> Forçando uso do fallback REST');
    
    if (!this.db) {
      console.warn('⚠️ Instância do Firestore não disponível para a integração.');
    }

    // Aplicar configurações de conectividade se disponíveis
    if (connectivityConfig?.config) {
      this.adaptiveBatchSize = connectivityConfig.config.batchSize;
      this.currentTimeout = connectivityConfig.config.timeout;
      console.log(`🎯 Configuração adaptativa aplicada: Batch ${this.adaptiveBatchSize}, Timeout ${this.currentTimeout/1000}s`);
    }
  }

  /**
   * CRÍTICO: Encerra adequadamente as conexões do Firebase para resolver DEADLINE_EXCEEDED
   */
  async encerrarConexoes() {
    try {
      console.log('🔄 Encerrando conexões Firebase...');
  const { getApps } = await import('firebase-admin/app');
      const apps = getApps();
      
      for (const app of apps) {
        await app.delete();
      }
      
      console.log('✅ Conexões Firebase encerradas com sucesso');
    } catch (error) {
      console.warn('⚠️ Erro ao encerrar conexões Firebase:', error.message);
    }
  }

  /**
   * Retorna a instância do DB para ser usada por outros módulos.
   */
  getDb() {
    return this.db;
  }

  /**
   * Processa e salva dados de deputados no Firestore
   */
  async salvarDadosDeputados(dadosProcessados) {
    console.log('🔥 Iniciando integração com Firestore...');
    console.log(`📊 Dados a processar: ${dadosProcessados.deputados.length} deputados`);
    console.log(`💰 Total de despesas: ${dadosProcessados.totalDespesas}`);
    console.log('');

    const startTime = Date.now();

    // Verificar se o Firebase está configurado
    if (!this.db) {
      if (this.forceRest) {
        console.log('⚠️ Instância do Firestore não disponível, mas FIRESTORE_FORCE_REST=true -> usando fallback REST');
        try {
          await this.salvarDadosDeputadosViaREST(dadosProcessados, startTime);
          return;
        } catch (e) {
          console.error('❌ Falha no fallback REST forçado:', e.message);
          throw e;
        }
      }

      console.log('🎭 MODO SIMULAÇÃO ATIVO');
      console.log('═'.repeat(50));
      return this.simularIntegracaoFirestore(dadosProcessados, startTime);
    }

  try {
      // 1. Salvar metadados da sessão
      await this.salvarMetadadosSessao(dadosProcessados);

      // 2. Processar deputados em batches
      await this.processarDeputadosEmBatches(dadosProcessados.deputados);

      // 3. Salvar estatísticas finais
      await this.salvarEstatisticasFinais(dadosProcessados, startTime);

      const tempoTotal = Date.now() - startTime;
      console.log('');
      console.log('🎉 INTEGRAÇÃO FIRESTORE CONCLUÍDA COM SUCESSO!');
      console.log('═'.repeat(60));
      
      // Métricas básicas
      console.log(`📝 Documentos salvos: ${this.documentsWritten}`);
      console.log(`📦 Batches executados: ${this.batchCount}`);
      console.log(`⏱️ Tempo total: ${(tempoTotal / 1000).toFixed(2)}s`);
      console.log(`🚀 Performance: ${(this.documentsWritten / (tempoTotal / 1000)).toFixed(1)} docs/s`);
      
      // Métricas avançadas
      const successRate = this.batchCount > 0 ? (this.successfulBatches / this.batchCount * 100).toFixed(1) : 0;
      console.log(`📊 Taxa de sucesso: ${successRate}% (${this.successfulBatches}/${this.batchCount})`);
      console.log(`🎯 Batch size final: ${this.adaptiveBatchSize}`);
      
      if (this.connectivityConfig?.quality) {
        console.log(`🌐 Qualidade da conexão: ${this.connectivityConfig.quality.toUpperCase()}`);
      }
      
      if (this.errors.length > 0) {
        console.log(`⚠️ Erros encontrados: ${this.errors.length}`);
        this.errors.forEach((error, index) => {
          console.log(`   ${index + 1}. ${error}`);
        });
      }
      
      // Salvar relatório de performance
      this.salvarRelatorioPerformance(tempoTotal);

    } catch (error) {
      // Log completo para diagnóstico (ajuda a entender formato do erro gRPC)
      try {
        console.error('💥 ERRO FATAL na integração Firestore:', error && (error.stack || error.message || String(error)));
      } catch (logErr) {
        console.error('💥 ERRO FATAL na integração Firestore (não-string):', String(error));
      }

      // Detecção robusta de DEADLINE_EXCEEDED (vários formatos possíveis do SDK)
      const isDeadline = (err) => {
        if (!err) return false;
        try {
          const msg = (err.message || err.stack || String(err) || '').toString();
          if (msg.includes('DEADLINE_EXCEEDED')) return true;
          if (err.code === 4) return true; // gRPC status code 4
          if (err.status === 4 || err.status === 'DEADLINE_EXCEEDED') return true;
        } catch (e) {
          return false;
        }
        return false;
      };

      if (isDeadline(error)) {
        console.warn('⚠️ DEADLINE_EXCEEDED detectado. Tentando fallback de escrita via Firestore REST...');
        try {
          await this.salvarDadosDeputadosViaREST(dadosProcessados, startTime);
          return;
        } catch (restErr) {
          console.error('❌ Falha no fallback REST:', restErr && (restErr.message || String(restErr)));
          throw restErr;
        }
      }

      throw error;
    } finally {
      // CRÍTICO: Sempre encerrar conexões para evitar DEADLINE_EXCEEDED
      await this.encerrarConexoes();
    }
  }

  /**
   * Fallback simples que persiste documentos via Firestore REST API
   * (mais tolerante a ambientes sem suporte gRPC). É uma implementação
   * conservadora: escreve documentos individualmente com retries simples.
   */
  async salvarDadosDeputadosViaREST(dadosProcessados, startTime) {
  console.log('\n' + '='.repeat(80));
  console.log('🔄 ATIVANDO FALLBACK: PERSISTÊNCIA VIA REST API (FORÇADO OU ERRO gRPC)');
  console.log('='.repeat(80) + '\n');

  // reset counters for the REST run
  this.restDocumentsWritten = 0;
  this.restErrors = 0;

    // Obter access token via JWT
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './config/serviceAccountKey.json';
    const sa = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    const project = sa.project_id;

    // obter token
    const base64url = s => Buffer.from(s).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
    const now = Math.floor(Date.now()/1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claim = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };
    const unsigned = base64url(JSON.stringify(header))+'.'+base64url(JSON.stringify(claim));
    const crypto = await import('crypto');
    const sign = crypto.sign('RSA-SHA256', Buffer.from(unsigned), { key: sa.private_key, padding: crypto.constants.RSA_PKCS1_PADDING });
    const jwt = unsigned + '.' + base64url(sign);

    const tokenResp = await fetch('https://oauth2.googleapis.com/token',{
      method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
    });
    if (!tokenResp.ok) throw new Error('Token exchange failed: ' + await tokenResp.text());
    const tokenJson = await tokenResp.json();
    const accessToken = tokenJson.access_token;

    // Helper converter (mapa recursivo para format Firestore REST fields)
    function toValue(v) {
      if (v === null || v === undefined) return { nullValue: null };
      if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
      switch (typeof v) {
        case 'boolean': return { booleanValue: v };
        case 'number':
          // prefer integer if safe
          if (Number.isInteger(v)) return { integerValue: String(v) };
          return { doubleValue: v };
        case 'string': return { stringValue: v };
        case 'object': {
          const fields = {};
          for (const k of Object.keys(v)) fields[k] = toValue(v[k]);
          return { mapValue: { fields } };
        }
        default: return { stringValue: String(v) };
      }
    }

    // small helper to PUT a document
    async function restSetDoc(path, data) {
      const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${path}`;
      const body = { fields: {} };
      for (const k of Object.keys(data)) body.fields[k] = toValue(data[k]);

      // retry simples
      for (let attempt=1; attempt<=3; attempt++) {
        const resp = await fetch(url, { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (resp.ok) return await resp.json();
  const txt = await resp.text();
  console.warn(`   REST write attempt ${attempt} failed for ${path}: ${resp.status} ${txt}`);
  if (attempt===3) throw new Error(`REST write failed: ${resp.status} ${txt}`);
        await new Promise(r=>setTimeout(r, 1000*attempt));
      }
    }

    // Salvar metadados de sessão
    try {
      const sessionId = `etl_${dadosProcessados.legislatura}_${Date.now()}`;
      console.log(`🔖 [REST] Criando sessionId ${sessionId}`);
      await restSetDoc(`etl_sessions/${sessionId}`, {
        legislatura: dadosProcessados.legislatura,
        totalDeputados: dadosProcessados.totalDeputados,
        processados: dadosProcessados.processados,
        sucessos: dadosProcessados.sucessos,
        falhas: dadosProcessados.falhas,
        totalDespesas: dadosProcessados.totalDespesas,
        timestamp: new Date().toISOString(),
        status: 'processing'
      });
  console.log('✅ Sessão salva via REST:', sessionId);
    } catch (e) {
      console.warn('⚠️ Falha ao salvar sessão via REST:', e.message);
    }

    // Salvar deputados e despesas de forma simples
    for (const deputado of dadosProcessados.deputados || []) {
      const depNome = deputado.nome || deputado.nomeEleitoral || deputado.nomeCivil || ('id_' + (deputado.id || Date.now()));
      try {
        console.log(`   🔁 [REST] Salvando deputado: ${depNome}`);
        const depId = String(deputado.id || deputado.idDeputado || Date.now());
        await restSetDoc(`deputados/${depId}`, { id: deputado.id, nome: depNome, partido: deputado.siglaPartido || deputado.partido || '', uf: deputado.siglaUf || deputado.uf || '', totalDespesas: deputado.totalDespesas || 0, valorTotal: deputado.valorTotal || 0 });
        this.restDocumentsWritten++;

        // despesas
        const despesas = deputado.despesas || [];
        for (const desp of despesas) {
          try {
            const docId = `${depId}_${desp.ano || 'na'}_${desp.mes || 'na'}_${desp.codDocumento || desp.numDocumento || Date.now()}`;
            await restSetDoc(`despesas/${docId}`, { deputadoId: depId, deputadoNome: depNome, ...desp });
            this.restDocumentsWritten++;
          } catch (de) {
            this.restErrors++;
            console.warn(`   ⚠️ [REST] Falha ao salvar despesa para ${depNome}: ${de.message}`);
          }
        }
      } catch (e) {
        this.restErrors++;
        console.warn(`   ⚠️ [REST] Falha ao salvar deputado ${depNome}: ${e.message}`);
        // continuar com próximos deputados
      }
    }

    // salvar estatísticas finais
    try {
      const statsId = `stats_${dadosProcessados.legislatura}_${Date.now()}`;
      await restSetDoc(`etl_stats/${statsId}`, {
        legislatura: dadosProcessados.legislatura,
        totalDeputados: dadosProcessados.totalDeputados,
        totalDespesas: dadosProcessados.totalDespesas, // Note que despesas individuais podem ter falhado
        valorTotalProcessado: dadosProcessados.deputados.reduce((s,d)=>s+(d.valorTotal||0),0),
        tempoProcessamento: Date.now()-startTime,
        documentosSalvos: this.documentsWritten,
        batchesExecutados: 0, // Não aplicável para REST individual
        timestamp: new Date().toISOString()
      });
  console.log('✅ Estatísticas salvas via REST');
    } catch (e) {
      console.warn('⚠️ Falha ao salvar estatísticas via REST:', e.message);
    }

    const tempoTotal = Date.now() - startTime;
    console.log('');
    console.log('🎉 INTEGRAÇÃO VIA FALLBACK REST CONCLUÍDA!');
    console.log('═'.repeat(60));
    console.log(`📝 Documentos salvos via REST (aprox.): ${this.restDocumentsWritten || this.documentsWritten}`);
    console.log(`⏱️ Tempo total: ${(tempoTotal / 1000).toFixed(2)}s`);
    
    if ((this.restErrors || this.errors.length) > 0) {
      console.log(`⚠️ Erros encontrados durante o processo: REST errors=${this.restErrors || 0}, batch errors=${this.errors.length}`);
    } else {
      console.log('✅ Processo concluído sem erros fatais (erros individuais podem ter ocorrido).');
    }
  }

  /**
   * Simula integração Firestore quando não configurado
   */
  async simularIntegracaoFirestore(dadosProcessados, startTime) {
    console.log('📋 Simulando salvamento de metadados...');
    await new Promise(resolve => setTimeout(resolve, 200));
    console.log('✅ Metadados simulados');

    console.log('👥 Simulando processamento de deputados...');
    for (let i = 0; i < dadosProcessados.deputados.length; i++) {
      const deputado = dadosProcessados.deputados[i];
      console.log(`   📊 [${i + 1}/${dadosProcessados.deputados.length}] Processando ${deputado.nome}...`);
      
      // Simular delay de processamento
      await new Promise(resolve => setTimeout(resolve, 100));
      
      this.documentsWritten += 1 + (deputado.despesas?.length || 0);
      if (this.documentsWritten % 100 === 0) {
        this.batchCount++;
        console.log(`   💾 Batch simulado ${this.batchCount} (${this.documentsWritten} documentos)`);
      }
    }

    console.log('📈 Simulando estatísticas finais...');
    await new Promise(resolve => setTimeout(resolve, 100));

    const tempoTotal = Date.now() - startTime;
    console.log('');
    console.log('🎭 SIMULAÇÃO FIRESTORE CONCLUÍDA!');
    console.log('═'.repeat(50));
    console.log(`📝 Documentos simulados: ${this.documentsWritten}`);
    console.log(`📦 Batches simulados: ${this.batchCount || 1}`);
    console.log(`⏱️ Tempo total: ${(tempoTotal / 1000).toFixed(2)}s`);
    console.log(`🚀 Performance simulada: ${(this.documentsWritten / (tempoTotal / 1000)).toFixed(1)} docs/s`);
    console.log('');
    console.log('💡 Para usar Firestore real, configure as variáveis VITE_FIREBASE_* no .env');
  }

  /**
   * Salva metadados da sessão ETL
   */
  async salvarMetadadosSessao(dados) {
    console.log('📋 Salvando metadados da sessão...');
    
    const sessionId = `etl_${dados.legislatura}_${Date.now()}`;
    const sessionDoc = this.db.collection('etl_sessions').doc(sessionId);
    
    const sessionData = {
      legislatura: dados.legislatura,
      totalDeputados: dados.totalDeputados,
      processados: dados.processados,
      sucessos: dados.sucessos,
      falhas: dados.falhas,
      totalDespesas: dados.totalDespesas,
      timestamp: FieldValue.serverTimestamp(),
      status: 'processing'
    };

    // Timeout adaptativo para evitar travamento
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`TIMEOUT: Metadados - ${this.currentTimeout/1000}s`)), this.currentTimeout);
    });

    try {
      await Promise.race([
        this.executeWithRetry(async () => {
          const batch = this.db.batch();
          batch.set(sessionDoc, sessionData);
          await batch.commit();
          this.batchCount++;
          this.documentsWritten++;
        }, 2),
        timeout
      ]);

      console.log(`✅ Sessão ${sessionId} criada`);
      return sessionId;
    } catch (error) {
      if (error.message.includes('TIMEOUT')) {
        console.log('⚠️ Timeout nos metadados - continuando sem eles');
        return null;
      }
      throw error;
    }
  }

  /**
   * Processa deputados em batches otimizados
   */
  async processarDeputadosEmBatches(deputados) {
    console.log('👥 Processando deputados em batches...');
    
    let batch = this.db.batch();
    let operationsInBatch = 0;
    let deputadosProcessados = 0;

    for (const deputado of deputados) {
      try {
        // Criar documento do deputado
        const { despesas, ...dadosDeputado } = deputado; // ✅ SEPARAR despesas dos dados do deputado

        const deputadoDoc = this.db.collection('deputados').doc(deputado.id.toString());
        batch.set(deputadoDoc, { // Salvar apenas os dados do deputado
          id: dadosDeputado.id,
          nome: dadosDeputado.nome,
          partido: dadosDeputado.siglaPartido || dadosDeputado.partido,
          uf: dadosDeputado.siglaUf || dadosDeputado.uf,
          totalDespesas: dadosDeputado.totalDespesas,
          valorTotal: dadosDeputado.valorTotal,
          despesasPorAno: dadosDeputado.despesasPorAno || {},
          ultimaAtualizacao: FieldValue.serverTimestamp()
        });
        operationsInBatch++;

        // Processar despesas do deputado
        if (despesas && despesas.length > 0) {
          for (const despesa of despesas) {
            // Verificar se o batch está cheio (usando tamanho adaptativo)
            if (operationsInBatch >= this.adaptiveBatchSize - 1) {
              await this.executeBatch(batch);
              batch = this.db.batch();
              operationsInBatch = 0;
            }

            // ✅ OTIMIZAÇÃO: ID de documento determinístico para idempotência
            // Usa codDocumento se disponível, senão uma combinação de outros campos para criar um ID único.
            const despesaIdUnico = despesa.codDocumento || `${despesa.numDocumento}-${despesa.valorDocumento}-${despesa.cnpjCpfFornecedor}`;
            const despesaDoc = this.db.collection('despesas').doc(`${deputado.id}_${despesa.ano}_${despesa.mes}_${despesaIdUnico}`);
            batch.set(despesaDoc, {
              deputadoId: deputado.id,
              deputadoNome: deputado.nome,
              ...despesa,
              timestamp: FieldValue.serverTimestamp()
            });
            operationsInBatch++;
          }
        }

        deputadosProcessados++;
        
        if (deputadosProcessados % 10 === 0) {
          console.log(`   📊 Progresso: ${deputadosProcessados}/${deputados.length} deputados`);
        }

      } catch (error) {
        console.error(`❌ Erro ao processar deputado ${deputado.nome}:`, error.message);
        this.errors.push(`Deputado ${deputado.nome}: ${error.message}`);
        // Se o erro for DEADLINE_EXCEEDED do gRPC, rethrow para acionar fallback REST no nível superior
        if (error && typeof error.message === 'string' && error.message.includes('DEADLINE_EXCEEDED')) {
          console.warn('⚠️ DEADLINE_EXCEEDED detectado durante processamento de batches -> escalando para fallback REST');
          throw error;
        }
      }
    }

    // Executar batch final se houver operações pendentes
    if (operationsInBatch > 0) {
      await this.executeBatch(batch);
    }

    console.log(`✅ Processamento completo: ${deputadosProcessados} deputados`);
  }

  /**
   * Executa um batch com retry automático e ajuste adaptativo
   */
  async executeBatch(batch) {
    const batchStartTime = Date.now();
    
    // Timeout dinâmico baseado na qualidade da conexão
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`TIMEOUT: Commit do batch - ${this.currentTimeout/1000}s`)), this.currentTimeout);
    });

    try {
      await Promise.race([
        this.executeWithRetry(async () => {
          await batch.commit();
          this.batchCount++;
          this.successfulBatches++;
          
          const batchTime = Date.now() - batchStartTime;
          console.log(`   💾 Batch ${this.batchCount} salvo (${batchTime}ms, ${this.adaptiveBatchSize} ops)`);
          
          // Ajustar batch size baseado na performance
          this.adjustBatchSizeBasedOnPerformance(batchTime, true);
        }, 2),
        timeoutPromise
      ]);
    } catch (error) {
      this.failedBatches++;
      const batchTime = Date.now() - batchStartTime;
      
      console.error(`❌ Falha no batch ${this.batchCount + 1}: ${error.message} (${batchTime}ms)`);
      this.errors.push(`Batch ${this.batchCount + 1}: ${error.message}`);
      
      // Ajustar batch size baseado na falha
      this.adjustBatchSizeBasedOnPerformance(batchTime, false);
      
      // Se detectarmos DEADLINE_EXCEEDED do gRPC, escalamos para acionar o fallback REST
      try {
        if (error && typeof error.message === 'string' && error.message.includes('DEADLINE_EXCEEDED')) {
          console.warn('⚠️ DEADLINE_EXCEEDED detectado em batch.commit -> escalando para fallback REST');
          throw error; // relança para o nível superior tratar e acionar o fallback
        }
      } catch (e) {
        throw e;
      }

      // Para outros erros, não relançar o erro para permitir que o processo continue
    }
  }

  /**
   * Ajusta o tamanho do batch baseado na performance
   */
  adjustBatchSizeBasedOnPerformance(batchTime, success) {
    const successRate = this.successfulBatches / (this.successfulBatches + this.failedBatches);
    
    if (!success || batchTime > this.currentTimeout * 0.8) {
      // Reduzir batch size se falhou ou está muito lento
      if (this.adaptiveBatchSize > BATCH_SIZE_MINIMAL) {
        this.adaptiveBatchSize = Math.max(
          Math.floor(this.adaptiveBatchSize * 0.7),
          BATCH_SIZE_MINIMAL
        );
        console.log(`   📉 Batch size reduzido para ${this.adaptiveBatchSize} (performance: ${batchTime}ms)`);
      }
    } else if (success && batchTime < this.currentTimeout * 0.3 && successRate > 0.9) {
      // Aumentar batch size se está indo bem
      if (this.adaptiveBatchSize < BATCH_SIZE_INITIAL) {
        this.adaptiveBatchSize = Math.min(
          Math.floor(this.adaptiveBatchSize * 1.2),
          Math.floor(this.adaptiveBatchSize * 1.1), // Aumento mais conservador
          BATCH_SIZE_INITIAL
        );
        console.log(`   📈 Batch size aumentado para ${this.adaptiveBatchSize} (performance: ${batchTime}ms)`);
      }
    }
  }

  /**
   * Salva estatísticas finais da sessão
   */
  async salvarEstatisticasFinais(dados, startTime) {
    console.log('📈 Salvando estatísticas finais...');
    
    const statsDoc = this.db.collection('etl_stats').doc(`stats_${dados.legislatura}_${Date.now()}`);
    const tempoProcessamento = Date.now() - startTime;
    
    const statsData = {
      legislatura: dados.legislatura,
      totalDeputados: dados.totalDeputados,
      totalDespesas: dados.totalDespesas,
      valorTotalProcessado: dados.deputados.reduce((sum, dep) => sum + dep.valorTotal, 0),
      tempoProcessamento,
      documentosSalvos: this.documentsWritten,
      batchesExecutados: this.batchCount,
      performance: this.documentsWritten / (tempoProcessamento / 1000),
      timestamp: FieldValue.serverTimestamp(),
      erros: this.errors.length
    };

    await this.executeWithRetry(async () => {
      const batch = this.db.batch();
      batch.set(statsDoc, statsData);
      await batch.commit();
      this.documentsWritten++;
    }, 2);

    console.log('✅ Estatísticas salvas');
  }

  /**
   * Executa operação com retry automático
   */
  async executeWithRetry(operation, retries = MAX_RETRIES) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await operation();
        return; // Sucesso
      } catch (error) {
        console.warn(`⚠️ Tentativa ${attempt}/${retries} falhou: ${error.message}`);

        // Se for um DEADLINE_EXCEEDED do gRPC, escalamos imediatamente para o nível superior
        if (error && typeof error.message === 'string' && error.message.includes('DEADLINE_EXCEEDED')) {
          console.warn('⚠️ Erro gRPC DEADLINE_EXCEEDED detectado dentro do retry -> escalando para fallback');
          throw error;
        }

        if (attempt === retries) {
          throw error; // Última tentativa falhou
        }
        
        // Backoff exponencial
        const delay = RETRY_DELAY_BASE * Math.pow(2, attempt - 1) + Math.random() * 1000;
        console.log(`   🕒 Aguardando ${Math.round(delay / 1000)}s para a próxima tentativa...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Salva relatório detalhado de performance
   */
  salvarRelatorioPerformance(tempoTotal) {
    try {
      const relatorio = {
        timestamp: new Date().toISOString(),
        performance: {
          tempoTotal: tempoTotal,
          tempoTotalSeconds: (tempoTotal / 1000),
          documentosSalvos: this.documentsWritten,
          batchesExecutados: this.batchCount,
          batchesSucesso: this.successfulBatches,
          batchesFalha: this.failedBatches,
          taxaSucesso: this.batchCount > 0 ? (this.successfulBatches / this.batchCount) : 0,
          docsPerSecond: this.documentsWritten / (tempoTotal / 1000),
          batchSizeFinal: this.adaptiveBatchSize,
          timeoutUtilizado: this.currentTimeout
        },
        conectividade: this.connectivityConfig || null,
        erros: this.errors,
        configuracoes: {
          batchSizeInicial: BATCH_SIZE_INITIAL,
          batchSizeConservativo: BATCH_SIZE_CONSERVATIVE,
          batchSizeMinimo: BATCH_SIZE_MINIMAL,
          maxRetries: MAX_RETRIES,
          retryDelayBase: RETRY_DELAY_BASE
        }
      };

      const { writeFileSync, existsSync, mkdirSync } = require('fs');
      
      if (!existsSync('./relatorios')) {
        mkdirSync('./relatorios');
      }

      const nomeArquivo = `./relatorios/performance_firestore_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`;
      writeFileSync(nomeArquivo, JSON.stringify(relatorio, null, 2));
      
      console.log(`📊 Relatório de performance salvo: ${nomeArquivo}`);
      
    } catch (error) {
      console.warn('⚠️ Falha ao salvar relatório de performance:', error.message);
    }
  }
}

/**
 * Função principal para integração via linha de comando
 */
async function integrarComFirestore(caminhoArquivoDados) {
  try {
    console.log('🔥 ETL FIRESTORE INTEGRATION');
    console.log('════════════════════════════════════════');
    console.log('');

    // Carregar dados processados
    console.log(`📂 Carregando dados de: ${caminhoArquivoDados}`);
    const dadosProcessados = JSON.parse(readFileSync(caminhoArquivoDados, 'utf8'));
    
    console.log('✅ Dados carregados com sucesso');
    console.log('');

    // Inicializar integração
    const integracao = new FirestoreETLIntegration();
    
    // Executar integração
    await integracao.salvarDadosDeputados(dadosProcessados);

  } catch (error) {
    console.error('💥 ERRO FATAL:', error.message);
    process.exit(1);
  }
}

// Execução via linha de comando apenas se chamado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2]) {
    const arquivoDados = process.argv[2];
    integrarComFirestore(arquivoDados);
  } else {
    console.log('📋 Uso: node etl-firestore-integration.js <caminho-para-arquivo-dados.json>');
    console.log('');
    console.log('Exemplo:');
    console.log('  node etl-firestore-integration.js ./dados_processados/despesas_legislatura_57_2025-01-08.json');
  }
}

export { FirestoreETLIntegration };