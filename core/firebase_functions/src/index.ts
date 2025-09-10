import functions from 'firebase-functions';
import { initializeFirebaseAdmin, getFirestoreAdminDb } from '../../../../services/firebase/firebase-admin-init.js';
import axios from 'axios';
import { Response } from 'express';

// Inicializar o Firebase Admin SDK e obter a instância do Firestore
initializeFirebaseAdmin();
const db = getFirestoreAdminDb();

// Função de exemplo: busca dados do wrapper e grava no Firestore
export const importarSenado = functions.https.onRequest(async (_req: functions.https.Request, res: Response) => {
  try {
    // Altere a URL abaixo para o endpoint do seu wrapper local
    const response = await axios.get('http://localhost:3000/api/senado/exemplo');
    const dados = response.data;

    // Grava no Firestore (coleção de exemplo)
    await db.collection('senado_exemplo').add(dados);

    res.status(200).send({ sucesso: true, dados });
  } catch (error) {
    console.error(error);
    const mensagem = error instanceof Error ? error.message : String(error);
    res.status(500).send({ sucesso: false, erro: mensagem });
  }
});
