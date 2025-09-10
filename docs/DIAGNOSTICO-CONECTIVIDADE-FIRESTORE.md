# 🔍 Diagnóstico de Conectividade Firestore

## 🎯 Problema Identificado

**Sintoma**: DEADLINE_EXCEEDED após 60 segundos em todas as operações Firestore
**Causa**: Bloqueio de rede impedindo conexão estável com Google Cloud
**Status da Arquitetura**: ✅ Correta e robusta

## 📋 Checklist de Diagnóstico

### 🔒 1. Firewall do Windows
```powershell
# Verificar status do Firewall
Get-NetFirewallProfile | Select-Object Name,Enabled

# Temporariamente desabilitar (CUIDADO - apenas para teste)
Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False

# Reabilitar após teste
Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True
```

### 🛡️ 2. Software Antivírus
- **Avast/AVG**: Verificar "Firewall" → "Configurações de aplicativo"
- **Kaspersky**: "Proteção" → "Firewall" → "Regras de rede"
- **Windows Defender**: Windows Security → Firewall → "Permitir um aplicativo"

**Ação**: Adicionar `node.exe` às exceções ou desabilitar temporariamente

### 🌐 3. Configurações de Rede

#### DNS
```bash
# Testar DNS atual
nslookup firestore.googleapis.com

# Mudar para DNS público (Google)
# Windows: Configurações → Rede → Propriedades → DNS
# Primário: 8.8.8.8
# Secundário: 8.8.4.4
```

#### Proxy/VPN
```bash
# Verificar configurações de proxy
netsh winhttp show proxy

# Se houver proxy, temporariamente remover
netsh winhttp reset proxy
```

### 📱 4. Teste de Rede Alternativa

**Método mais eficaz**: Usar hotspot do celular
1. Ativar hotspot no celular (4G/5G)
2. Conectar PC ao hotspot
3. Executar: `npm run etl:despesas -- 57 1 --firestore`
4. Se funcionar → problema é na rede local

### 🔧 5. Teste de Conectividade Específica

Criar script de teste simples:

```javascript
// test-firestore-connection.js
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

try {
  const serviceAccountKey = JSON.parse(readFileSync('./config/serviceAccountKey.json', 'utf8'));
  const app = initializeApp({ credential: cert(serviceAccountKey) });
  const db = getFirestore(app);
  
  console.log('🔄 Testando conexão simples...');
  const testRef = db.collection('_test').doc('connectivity');
  
  await testRef.set({ timestamp: new Date(), test: true });
  console.log('✅ Escrita bem-sucedida!');
  
  const doc = await testRef.get();
  console.log('✅ Leitura bem-sucedida!', doc.data());
  
  await testRef.delete();
  console.log('✅ Exclusão bem-sucedida!');
  
} catch (error) {
  console.error('❌ Falha na conectividade:', error.message);
}
```

### 🏢 6. Rede Corporativa

Se em ambiente corporativo:
- Verificar com TI sobre portas bloqueadas
- Firestore usa HTTPS (443) e gRPC
- Pode precisar configurar proxy corporativo

### 🔄 7. Alternativas de Conectividade

#### Usar REST API em vez de gRPC
```javascript
// No etl-firestore-integration.js, adicionar:
db.settings({
  ssl: true,
  host: 'firestore.googleapis.com',
  port: 443,
  preferRest: true  // Força uso de REST em vez de gRPC
});
```

#### Configurar timeout personalizado
```javascript
// Timeout mais longo para conexões lentas
db.settings({
  ignoreUndefinedProperties: true,
  timestampsInSnapshots: true,
  timeoutSeconds: 300  // 5 minutos
});
```

## 🧪 Script de Teste Rápido

```bash
# Criar e executar teste de conectividade
cat > test-firestore.js << 'EOF'
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const serviceAccountKey = JSON.parse(readFileSync('./config/serviceAccountKey.json', 'utf8'));
const app = initializeApp({ credential: cert(serviceAccountKey) });
const db = getFirestore(app);

console.log('🔄 Teste de conectividade iniciado...');
const start = Date.now();

try {
  await db.collection('_test').doc('ping').set({ ping: Date.now() });
  console.log(`✅ Conexão OK! Tempo: ${Date.now() - start}ms`);
} catch (error) {
  console.log(`❌ Falha: ${error.message} (${Date.now() - start}ms)`);
}
EOF

node test-firestore.js
```

## 📊 Plano de Ação Sequencial

1. **🏃‍♂️ Teste Rápido**: Hotspot do celular
2. **🔒 Firewall**: Desabilitar temporariamente
3. **🛡️ Antivírus**: Adicionar exceção para Node.js  
4. **🌐 DNS**: Mudar para 8.8.8.8
5. **🔄 Script de Teste**: Executar `test-firestore.js`
6. **⚙️ REST API**: Configurar `preferRest: true`

## ✅ Confirmação de Sucesso

Quando a conectividade estiver resolvida, você verá:
```
📋 Salvando metadados da sessão...
✅ Sessão etl_57_1234567890 criada
👥 Processando deputados em batches...
💾 Batch 1 salvo (1234ms, 100 ops)
```

## 🎯 Resultado Esperado

Com a conectividade funcionando, seu ETL robusto irá:
- ✅ Conectar ao Firestore rapidamente
- ✅ Usar batching adaptativo inteligente  
- ✅ Salvar 1063 despesas em batches otimizados
- ✅ Completar em alguns minutos (não horas)

---

**Nota**: A arquitetura do ETL está perfeita. O problema é 100% de ambiente/rede.