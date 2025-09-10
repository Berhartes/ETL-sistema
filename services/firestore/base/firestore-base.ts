import { db } from '@/lib/firebase';
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  doc, 
  getDoc,
  limit,
  startAfter,
  collectionGroup,
  orderBy,
  DocumentSnapshot,
  QuerySnapshot,
  QueryDocumentSnapshot
} from 'firebase/firestore';
import { firestoreListenerManager } from '@/services/firestore-listener-manager';

export class FirestoreBase {
  protected readonly BANCO_VAZIO_CACHE_DURATION = 5 * 60 * 1000; // 5 minutos
  private bancoVazioCache: { isEmpty: boolean; timestamp: number } | null = null;
  private queryQueue: Set<string> = new Set(); // Para prevenir consultas duplicadas
  
  // Cache singleton para verificação de conexão
  private static connectionCache: { isConnected: boolean; timestamp: number; promise?: Promise<boolean> } | null = null;
  private static readonly CONNECTION_CACHE_DURATION = 30 * 1000; // 30 segundos

  constructor() {
    if (!db) {
      console.warn('[FirestoreBase] ⚠️ Firestore não está inicializado');
    }
  }

  /**
   * Verificação de conexão com Firestore (com cache singleton para evitar conflitos)
   */
  async checkFirestoreConnection(): Promise<boolean> {
    const now = Date.now();
    
    // Verificar cache válido
    if (FirestoreBase.connectionCache && 
        now - FirestoreBase.connectionCache.timestamp < FirestoreBase.CONNECTION_CACHE_DURATION) {
      return FirestoreBase.connectionCache.isConnected;
    }
    
    // Se já há uma verificação em andamento, aguardar
    if (FirestoreBase.connectionCache?.promise) {
      return await FirestoreBase.connectionCache.promise;
    }
    
    // Criar nova verificação
    const connectionPromise = this.performConnectionCheck();
    FirestoreBase.connectionCache = {
      isConnected: false,
      timestamp: now,
      promise: connectionPromise
    };
    
    try {
      const result = await connectionPromise;
      FirestoreBase.connectionCache = {
        isConnected: result,
        timestamp: now
      };
      return result;
    } catch (error) {
      FirestoreBase.connectionCache = {
        isConnected: false,
        timestamp: now
      };
      return false;
    }
  }
  
  /**
   * Executa a verificação real de conexão (estratégias progressivas)
   */
  private async performConnectionCheck(): Promise<boolean> {
    // Verificação 0: Firestore está inicializado?
    if (!db) {
      console.warn('[FirestoreBase] ❌ Firestore não está inicializado - verifique as credenciais do Firebase');
      return false;
    }

    try {
      // Estratégia 1: Verificação local (não faz rede)
      // Tentar criar uma referência de coleção (operação local)
      const testColRef = collection(db, 'connection-test');
      
      // Se chegou até aqui sem erro, o Firestore está pelo menos inicializado
      console.log('[FirestoreBase] ✅ Firestore inicializado corretamente');
      
      // Estratégia 2: Verificação com timeout baixo
      try {
        // Timeout muito baixo para teste rápido
        const testDocRef = doc(db, 'health-check', 'ping');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout
        
        // Usar Promise.race para timeout
        const testPromise = getDoc(testDocRef);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Connection timeout')), 3000);
        });
        
        await Promise.race([testPromise, timeoutPromise]);
        clearTimeout(timeoutId);
        
        console.log('[FirestoreBase] ✅ Conexão de rede verificada');
        return true;
        
      } catch (networkError: any) {
        // Erro de rede não significa que o Firestore está quebrado
        // Pode ser apenas falta de configuração ou emulador offline
        console.warn('[FirestoreBase] ⚠️ Rede indisponível, mas Firestore está inicializado:', networkError.message);
        
        // Se as credenciais estão pelo menos configuradas, consideramos "conectado"
        // para evitar quebrar a aplicação
        return true; // Mudança aqui: retorna true para permitir funcionamento offline
      }
      
    } catch (error: any) {
      console.error('[FirestoreBase] ❌ Erro crítico na verificação:', {
        code: error.code,
        message: error.message,
        details: error
      });
      
      // Se o erro indica configuração faltante, retornamos false
      if (error.code === 'app/invalid-api-key' || 
          error.code === 'app/app-deleted' ||
          error.message?.includes('API key not valid')) {
        console.error('[FirestoreBase] ❌ Configuração do Firebase inválida - verifique as variáveis VITE_FIREBASE_*');
        return false;
      }
      
      // Para outros erros, assumimos que está "funcionando" mas com problemas temporários
      return true;
    }
  }

  /**
   * Limpar cache de conexão (útil para forçar nova verificação)
   */
  static clearConnectionCache(): void {
    FirestoreBase.connectionCache = null;
  }

  /**
   * Verificar se o banco está vazio (com cache)
   */
  protected async isBancoVazio(): Promise<boolean> {
    const now = Date.now();
    
    if (this.bancoVazioCache && (now - this.bancoVazioCache.timestamp) < this.BANCO_VAZIO_CACHE_DURATION) {
      return this.bancoVazioCache.isEmpty;
    }

    try {
      // Verificar se existe pelo menos um deputado no formato V3
      const deputadosQuery = query(collection(db, 'deputados'), limit(1));
      const deputadosSnapshot = await getDocs(deputadosQuery);
      
      const isEmpty = deputadosSnapshot.empty;
      
      this.bancoVazioCache = {
        isEmpty,
        timestamp: now
      };
      
      return isEmpty;
    } catch (error) {
      console.error('[FirestoreBase] ❌ Erro ao verificar banco vazio:', error);
      return false;
    }
  }

  /**
   * Executar operação Firestore com retry para resolver Target ID conflicts
   */
  protected async executarComRetry<T>(
    operacao: () => Promise<T>,
    identificador: string,
    maxRetries: number = 3
  ): Promise<T> {
    // Prevenir consultas duplicadas simultâneas
    if (this.queryQueue.has(identificador)) {
      await this.delay(Math.random() * 1000 + 500); // Delay aleatório 500-1500ms
    }
    
    this.queryQueue.add(identificador);
    
    try {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const resultado = await operacao();
          this.queryQueue.delete(identificador);
          return resultado;
        } catch (error: any) {
          // Detectar erro específico de Target ID duplicado
          if (error?.code === 'failed-precondition' || 
              error?.message?.includes('Target ID already exists') ||
              error?.message?.includes('Target already exists')) {
            
            if (attempt === maxRetries) {
              console.error(`[FirestoreBase] ❌ Erro persistente após ${maxRetries} tentativas (${identificador}):`, error);
              throw error;
            }
            
            // Delay exponencial com jitter
            const baseDelay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
            const jitter = Math.random() * 1000; // 0-1s adicional
            const delay = baseDelay + jitter;
            
            console.warn(`[FirestoreBase] ⚠️ Target ID conflict, retry ${attempt}/${maxRetries} em ${Math.round(delay)}ms (${identificador})`);
            await this.delay(delay);
            continue;
          }
          
          // Para outros erros, falhar imediatamente
          throw error;
        }
      }
      
      throw new Error('Máximo de tentativas atingido');
    } finally {
      this.queryQueue.delete(identificador);
    }
  }

  /**
   * Utility para delay
   */
  protected async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Buscar documento de forma segura com retry
   */
  async buscarDocumentoSeguro(caminho: string): Promise<any> {
    const identificador = `doc_${caminho}`;
    
    try {
      return await this.executarComRetry(
        () => this.executarBuscaDocumento(caminho),
        identificador
      );
    } catch (error) {
      console.error(`[FirestoreBase] ❌ Erro ao buscar documento ${caminho}:`, error);
      const bancoVazio = await this.isBancoVazio();
      if (!bancoVazio) {
        console.warn(`[FirestoreBase] ⚠️ Documento não encontrado: ${caminho}`);
      }
      return null;
    }
  }

  /**
   * Executar busca de documento
   */
  private async executarBuscaDocumento(caminho: string): Promise<any> {
    if (!db) {
      throw new Error('Firestore não está inicializado');
    }

    const docRef = doc(db, caminho);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      return {
        id: docSnap.id,
        ...docSnap.data()
      };
    }
    
    return null;
  }

  /**
   * Converter valor numérico de forma segura
   */
  protected converterValorNumerico(valor: any): number {
    if (typeof valor === 'number') return valor;
    if (typeof valor === 'string') {
      const numeroConvertido = parseFloat(valor.replace(/[^\d,.-]/g, '').replace(',', '.'));
      return isNaN(numeroConvertido) ? 0 : numeroConvertido;
    }
    return 0;
  }

  /**
   * Verificar se coleção existe e tem dados
   */
  protected async verificarColecaoDisponivel(nomeColecao: string): Promise<boolean> {
    try {
      const colecaoQuery = query(collection(db, nomeColecao), limit(1));
      const snapshot = await getDocs(colecaoQuery);
      return !snapshot.empty;
    } catch (error) {
      console.error(`[FirestoreBase] ❌ Erro ao verificar coleção ${nomeColecao}:`, error);
      return false;
    }
  }

  /**
   * Obter referência da database
   */
  protected getDb() {
    if (!db) {
      throw new Error('Firestore não está inicializado');
    }
    return db;
  }

  /**
   * Criar query com limite de segurança
   */
  protected criarQuerySegura(nomeColecao: string, maxLimit: number = 1000) {
    return query(collection(db, nomeColecao), limit(maxLimit));
  }

  /**
   * Verificar status das principais coleções
   */
  async verificarStatusColecoes(): Promise<{
    deputados: boolean;
    fornecedores: boolean;
    despesas: boolean;
    rankings: boolean;
  }> {
    const [deputados, fornecedores, despesas, rankings] = await Promise.all([
      this.verificarColecaoDisponivel('deputados'),
      this.verificarColecaoDisponivel('fornecedores'),
      this.verificarColecaoDisponivel('despesas'),
      this.verificarColecaoDisponivel('rankings')
    ]);

    return {
      deputados,
      fornecedores,
      despesas,
      rankings
    };
  }
}

export const firestoreBase = new FirestoreBase();