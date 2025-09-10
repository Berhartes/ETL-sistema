/**
 * 🎯 FIRESTORE LISTENER MANAGER
 * 
 * Sistema singleton para gerenciar listeners do Firestore e prevenir
 * erros de "Target ID already exists"
 */

import { db } from '@/lib/firebase'
import { 
  collection, 
  query, 
  onSnapshot, 
  QuerySnapshot, 
  Unsubscribe,
  DocumentSnapshot 
} from 'firebase/firestore'

interface ListenerInfo {
  id: string
  unsubscribe: Unsubscribe
  lastActivity: number
  isActive: boolean
}

class FirestoreListenerManager {
  private listeners = new Map<string, ListenerInfo>()
  private readonly LISTENER_TIMEOUT = 30000 // 30 segundos
  private readonly MAX_CONCURRENT_LISTENERS = 10
  private cleanupInterval?: NodeJS.Timeout

  constructor() {
    // Limpeza automática de listeners inativos
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveListeners()
    }, this.LISTENER_TIMEOUT)
  }

  /**
   * 🎯 Criar um listener único por identificador
   */
  createUniqueListener<T>(
    id: string,
    queryFactory: () => any,
    callback: (snapshot: QuerySnapshot | DocumentSnapshot) => void,
    errorCallback?: (error: Error) => void
  ): () => void {
    
    // Se já existe um listener ativo, reutilizar
    if (this.listeners.has(id)) {
      const existing = this.listeners.get(id)!
      existing.lastActivity = Date.now()
      console.log(`[FirestoreListenerManager] ♻️ Reutilizando listener: ${id}`)
      return existing.unsubscribe
    }

    // Limpar listeners antigos se atingir o limite
    if (this.listeners.size >= this.MAX_CONCURRENT_LISTENERS) {
      this.cleanupOldestListeners(3)
    }

    try {
      console.log(`[FirestoreListenerManager] 🎯 Criando listener: ${id}`)
      
      const firestoreQuery = queryFactory()
      
      // Criar o listener com retry para Target ID conflicts
      const unsubscribe = onSnapshot(
        firestoreQuery,
        (snapshot) => {
          const listener = this.listeners.get(id)
          if (listener) {
            listener.lastActivity = Date.now()
            listener.isActive = true
          }
          callback(snapshot)
        },
        (error) => {
          console.error(`[FirestoreListenerManager] ❌ Erro no listener ${id}:`, error)
          
          // Se for erro de Target ID, tentar recriar
          if (error.message?.includes('Target ID already exists') || 
              error.message?.includes('Target already exists')) {
            console.log(`[FirestoreListenerManager] 🔄 Recriando listener devido a Target ID: ${id}`)
            
            // Remover listener problemático
            this.removeListener(id)
            
            // Tentar recriar após delay
            setTimeout(() => {
              this.createUniqueListener(id, queryFactory, callback, errorCallback)
            }, Math.random() * 2000 + 1000) // Delay 1-3s
          }
          
          if (errorCallback) {
            errorCallback(error)
          }
        }
      )

      // Registrar listener
      this.listeners.set(id, {
        id,
        unsubscribe,
        lastActivity: Date.now(),
        isActive: true
      })

      // Retornar função de limpeza
      return () => this.removeListener(id)

    } catch (error) {
      console.error(`[FirestoreListenerManager] ❌ Erro ao criar listener ${id}:`, error)
      
      if (errorCallback) {
        errorCallback(error as Error)
      }
      
      return () => {} // Função vazia como fallback
    }
  }

  /**
   * 🗑️ Remover listener específico
   */
  removeListener(id: string): void {
    const listener = this.listeners.get(id)
    if (listener) {
      try {
        listener.unsubscribe()
        console.log(`[FirestoreListenerManager] 🗑️ Removendo listener: ${id}`)
      } catch (error) {
        console.error(`[FirestoreListenerManager] ❌ Erro ao remover listener ${id}:`, error)
      }
      this.listeners.delete(id)
    }
  }

  /**
   * 🧹 Limpeza de listeners inativos
   */
  private cleanupInactiveListeners(): void {
    const now = Date.now()
    const toRemove: string[] = []

    this.listeners.forEach((listener, id) => {
      if (now - listener.lastActivity > this.LISTENER_TIMEOUT) {
        toRemove.push(id)
      }
    })

    toRemove.forEach(id => {
      console.log(`[FirestoreListenerManager] ⏰ Removendo listener inativo: ${id}`)
      this.removeListener(id)
    })
  }

  /**
   * 🧹 Remover listeners mais antigos
   */
  private cleanupOldestListeners(count: number): void {
    const sortedListeners = Array.from(this.listeners.entries())
      .sort(([,a], [,b]) => a.lastActivity - b.lastActivity)

    for (let i = 0; i < Math.min(count, sortedListeners.length); i++) {
      const [id] = sortedListeners[i]
      console.log(`[FirestoreListenerManager] 🗑️ Removendo listener antigo: ${id}`)
      this.removeListener(id)
    }
  }

  /**
   * 🧹 Limpar todos os listeners
   */
  removeAllListeners(): void {
    console.log(`[FirestoreListenerManager] 🧹 Limpando todos os listeners (${this.listeners.size})`)
    
    this.listeners.forEach((_, id) => {
      this.removeListener(id)
    })
    
    this.listeners.clear()
  }

  /**
   * 📊 Estatísticas dos listeners
   */
  getStats(): { total: number; active: number; ids: string[] } {
    const now = Date.now()
    const active = Array.from(this.listeners.values())
      .filter(l => l.isActive && (now - l.lastActivity) < this.LISTENER_TIMEOUT).length
    
    return {
      total: this.listeners.size,
      active,
      ids: Array.from(this.listeners.keys())
    }
  }

  /**
   * 🛑 Destruir o manager
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    this.removeAllListeners()
  }
}

// Singleton instance
export const firestoreListenerManager = new FirestoreListenerManager()

// Cleanup no window unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    firestoreListenerManager.destroy()
  })
}