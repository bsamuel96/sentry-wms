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
  const detectorRef = useRef(null);
  const detectedRef = useRef(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [processing, setProcessing] = useState(false);

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
        detectorRef.current = detector;
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
        if (!cancelled) setReady(true);
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
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [onClose, onDetected]);

  async function captureAndProcess() {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector || !ready || processing || detectedRef.current) return;

    setProcessing(true);
    setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('capture_unavailable');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const barcodes = await detector.detect(canvas);
      const value = String(barcodes?.[0]?.rawValue || '').trim();
      if (!value) {
        setError('Nu am găsit un cod în fotografie. Apropie eticheta, evită reflexiile și încearcă din nou.');
        return;
      }
      detectedRef.current = true;
      onDetected(value);
      onClose();
    } catch (captureError) {
      if (captureError?.message !== 'capture_unavailable') {
        setError('Fotografia nu a putut fi procesată. Ține camera nemișcată și încearcă din nou.');
      } else {
        setError('Browserul nu poate captura cadrul camerei. Folosește Chrome actualizat.');
      }
    } finally {
      setProcessing(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Închide</button>
          <button type="button" className="btn btn-primary" onClick={captureAndProcess} disabled={!ready || processing}>
            {processing ? 'Se procesează…' : 'Fotografiază și procesează'}
          </button>
        </>
      )}
    >
      <div className="barcode-camera">
        <video ref={videoRef} className="barcode-camera-video" autoPlay muted playsInline aria-label="Imagine cameră pentru scanare" />
        <div className="barcode-camera-target" aria-hidden="true" />
        <p className="barcode-camera-hint">Încadrează clar codul, apoi apasă „Fotografiază și procesează”.</p>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
      </div>
    </Modal>
  );
}
