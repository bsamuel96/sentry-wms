# Sentry WMS Autosav pe Android

Aplicația mobilă folosește tema Autosav și poate scana cu camera unui telefon
Android obișnuit. URL-ul implicit al API-ului este:

`https://sentry-wms-production.up.railway.app`

## Test rapid cu Expo Go

1. Instalează **Expo Go** din Google Play.
2. Pe calculator, din folderul `mobile`, rulează:

   ```bash
   npm ci
   npx expo start --tunnel
   ```

3. Scanează codul QR afișat în terminal cu Expo Go.
4. Autentifică-te cu utilizatorul Sentry WMS.
5. Apasă `CAMERĂ` în orice câmp de scanare și acordă permisiunea cerută de
   Android.

Expo Go este potrivit pentru test. Pentru instalare permanentă folosește APK-ul.

## APK instalabil

Este necesar un cont Expo gratuit o singură dată:

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest init
npm run build:apk
```

La `eas init`, creează proiectul în contul Autosav. După build, Expo afișează
un link către APK; deschide linkul pe telefon și instalează fișierul.

Pachetul Android este `ro.autosavcar.sentrywms`, separat de aplicația upstream.

## Ce pot scana etichetele

- eticheta unui produs: deschide produsul și stocul pe locații;
- eticheta unui bin: deschide bin-ul și conținutul lui;
- eticheta `ROW-*`: confirmă rândul; pentru mișcări de stoc trebuie scanat apoi
  bin-ul exact;
- PO/SO: deschide fluxul operațional disponibil pentru document.

Camera este disponibilă în toate fluxurile care folosesc câmpul comun de
scanare: recepție, put-away, picking, packing, expediere, inventar și transfer.

## Casă / POS pe telefon

Cardul `CASĂ / POS` apare automat pentru administratori. Pentru un operator
obișnuit, bifează `Vânzare (POS)` în Admin → Utilizatori → Funcții permise și
atribuie-i depozitul din care poate vinde. Aplicația folosește autentificarea
normală a operatorului; nu introduce și nu distribuie un token WMS pe telefon.

Fluxul de vânzare este:

1. Scanează eticheta produsului sau introdu SKU-ul.
2. Dacă produsul există în mai multe locații, alege locația din care se vinde.
3. Reglează cantitatea și introdu prețul final pe bucată, cu TVA inclus.
4. Alege numerar sau card. Pentru card se notează numai marca, ultimele patru
   cifre, codul de autorizare și referința terminalului; nu se introduce PAN/CVV.
5. Apasă `VALIDEAZĂ ȘI FINALIZEAZĂ`. Serverul verifică din nou stocul și
   înregistrează vânzarea plus ieșirea din stoc într-o singură tranzacție.

Sentry nu deține lista comercială de prețuri și nu procesează plata bancară;
prețul final este introdus de casier, iar datele cardului confirmă o plată deja
acceptată de terminal. Repetarea aceleiași cereri după o eroare de rețea nu
dublează vânzarea, deoarece checkout-ul folosește o cheie de idempotency.
