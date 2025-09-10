/**
 * @file Configuração Firebase Admin para o projeto gastosdeputados
 */

import { initializeFirebaseAdmin, getFirestoreAdminDb } from './firebase-admin-init.js';

/**
 * Inicializa o Firebase Admin SDK.
 * @returns A instância do Firebase Admin App.
 */
export const initializeFirebase = initializeFirebaseAdmin;

/**
 * Obtém a instância do Firestore.
 * @returns A instância do Firestore.
 */
export const getDb = getFirestoreAdminDb;

/**
 * Encerra a conexão com o Firebase Admin SDK.
 * Útil para testes ou para garantir que os recursos sejam liberados.
 * NOTA: A implementação atual em firebase-admin-init não lida com o fechamento da aplicação.
 * A função admin.app().delete() pode ser usada para limpar uma app específica.
 * Se múltiplas apps não são usadas, o gerenciamento do ciclo de vida da app pode não ser crítico.
 */
export async function closeFirebaseConnection(): Promise<void> {
  // A lógica de fechamento pode ser expandida aqui se necessário.
  // Por exemplo, para deletar a app:
  // import { admin } from './firebase-admin-init.js';
  // const app = admin.app();
  // if (app) {
  //   await app.delete();
  //   console.log('Firebase Admin App encerrada.');
  // }
  console.log('Solicitação para encerrar conexão com Firebase Admin. (Implementação pendente se necessário)');
}

export default { initializeFirebase, getDb, closeFirebaseConnection };
