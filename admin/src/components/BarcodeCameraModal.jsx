import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';

const BARCODE_FORMATS = [
  'aztec',
  'code_128',
  'code_39',
  'code_93',
  'codabar',
  'data_matrix',
  'ean_13',
  'ean_8',
  'itf',
  'pdf417',
  'qr_code',
  'upc_a',
  'upc_e',
];

export default function BarcodeCameraModal({ title = 'Scanează codul', onClose, onDetected }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);
  const detectedRef = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      const BarcodeDetectorApi = window.BarcodeDetector;
      if (!BarcodeDetectorApi || !navigator.mediaDevices?.getUserMedia) {
        setError('Camera pentru coduri de bare nu este disponibilă în acest browser. Folosește Chrome pe Android sau un scanner USB/Bluetooth.');
        return;
      }

      try {
        const supported = typeof BarcodeDetectorApi.getSupportedFormats === 'function'
          ? await BarcodeDetectorApi.getSupportedFormats()
          : BARCODE_FORMATS;
        const formats = BARCODE_FORMATS.filter((format) => supported.includes(format));
        const detector = new BarcodeDetectorApi(formats.length ? { formats } : undefined);
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        async function inspectFrame() {
          if (cancelled || detectedRef.current) return;
          try {
            const barcodes = await detector.detect(video);
            const value = String(barcodes?.[0]?.rawValue || '').trim();
            if (value) {
              detectedRef.current = true;
              onDetected(value);
              onClose();
              return;
            }
          } catch {
            // A frame can be unreadable while the camera focuses. Keep trying.
          }
          frameRef.current = window.requestAnimationFrame(inspectFrame);
        }
        frameRef.current = window.requestAnimationFrame(inspectFrame);
      } catch (cameraError) {
        if (!cancelled) {
          const denied = cameraError?.name === 'NotAllowedError';
          setError(denied
            ? 'Accesul la cameră a fost refuzat. Permite camera pentru acest site și încearcă din nou.'
            : 'Camera nu a putut fi pornită. Verifică dacă este folosită de altă aplicație.');
        }
      }
    }

    startCamera();
    return () => {
      cancelled = true;
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [onClose, onDetected]);

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={<button type="button" className="btn" onClick={onClose}>Închide</button>}
    >
      <div className="barcode-camera">
        <video ref={videoRef} className="barcode-camera-video" autoPlay muted playsInline aria-label="Imagine cameră pentru scanare" />
        <div className="barcode-camera-target" aria-hidden="true" />
        <p className="barcode-camera-hint">Încadrează codul în dreptunghi. Citirea se face automat.</p>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
      </div>
    </Modal>
  );
}
