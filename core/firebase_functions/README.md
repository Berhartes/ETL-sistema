# Firebase Functions (Nova Estrutura)

## Instalação

```sh
cd src/core/functions/firebase_functions
npm install
```

## Build

```sh
npm run build
```

## Rodar emulador local

```sh
npm run serve
```

## Exemplo de função
- `importarSenado`: Consome o servidor wrapper do Senado Federal e grava dados no Firestore Emulator.
- Altere a URL no código para o endpoint correto do seu wrapper. 