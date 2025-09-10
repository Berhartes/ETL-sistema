import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Determina o diretório base do projeto para encontrar o service account
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Ajustado para subir três níveis (src/services/firebase) até a raiz do projeto gastosdeputados
const projectRoot = path.resolve(__dirname, '../../../'); 

let firebaseAdminApp: admin.app.App | null = null;
let firestoreAdminDb: admin.firestore.Firestore | null = null;

export function initializeFirebaseAdmin(): admin.app.App {
  if (firebaseAdminApp) {
    return firebaseAdminApp;
  }

  try {
    // Ajustado para buscar o serviceAccountKey.json dentro da pasta config
    const serviceAccountPath = path.join(projectRoot, 'config', 'serviceAccountKey.json');
    
    // Como estamos em um módulo ES, `require` não é o ideal para JSON.
    // Vamos ler o arquivo de forma síncrona e fazer o parse.
    // No entanto, para manter a compatibilidade com o código original e a simplicidade,
    // e assumindo que o ambiente de execução suporta `require` para JSON (comum em Node.js),
    // vamos manter o `require` por enquanto. Se der problema, precisaremos ajustar.
    // Uma alternativa seria usar `fs.readFileSync` e `JSON.parse`.
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

    firebaseAdminApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    console.log('Firebase Admin SDK inicializado com sucesso.');
    return firebaseAdminApp;
  } catch (error) {
    console.error('Erro ao inicializar Firebase Admin SDK:', error);
    // Em um cenário de servidor, talvez não queiramos sair do processo,
    // mas sim lançar o erro para ser tratado por quem chamou.
    // Por ora, mantendo o comportamento original.
    process.exit(1); 
  }
  
  // TypeScript will never reach here due to process.exit(1), but adding return to satisfy type checker
  return firebaseAdminApp;
}

export function getFirestoreAdminDb(): admin.firestore.Firestore {
  if (firestoreAdminDb) {
    return firestoreAdminDb;
  }

  if (!firebaseAdminApp) {
    initializeFirebaseAdmin();
  }

  // Garantir que firebaseAdminApp foi inicializado
  if (!firebaseAdminApp) {
    console.error('Falha ao obter o app Firebase Admin inicializado.');
    process.exit(1);
  }

  firestoreAdminDb = admin.firestore(firebaseAdminApp); // Passar o app explicitamente

  // Configurações para o emulador ou produção
  const useEmulator = process.env.USE_FIRESTORE_EMULATOR === 'true';
  if (useEmulator) {
    const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8000';
    firestoreAdminDb?.settings({
      host: emulatorHost,
      ssl: false,
      // experimentalForceLongPolling: true, // Esta opção pode não ser necessária ou causar problemas. Removida por precaução.
    });
    console.log(`Firestore Admin SDK conectado ao emulador em: ${emulatorHost}`);
  } else {
    firestoreAdminDb?.settings({
      ignoreUndefinedProperties: true
    });
    console.log('Firestore Admin SDK configurado para produção.');
  }

  return firestoreAdminDb!;
}

// Reexporta o módulo admin para tipos e outras funcionalidades, se necessário
export { admin };
