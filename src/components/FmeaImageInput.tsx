import { useCallback, useRef, useState } from 'react';
import { isImageDataUrl, isImagePlaceholder } from '../report/fmea';

interface Props {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}

/** 单张图片压缩：长边 ≤ 1200px，JPEG 0.8 质量；超过 2MB 再降到 0.6 */
async function compressToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = async () => {
      const src = String(reader.result || '');
      try {
        const img = await loadImage(src);
        const maxSide = 1200;
        let { width, height } = img;
        if (width > height && width > maxSide) {
          height = Math.round((height * maxSide) / width);
          width = maxSide;
        } else if (height > maxSide) {
          width = Math.round((width * maxSide) / height);
          height = maxSide;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 不可用');
        ctx.drawImage(img, 0, 0, width, height);
        let quality = 0.82;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        // 超过 2MB 再压一次
        while (dataUrl.length > 2 * 1024 * 1024 && quality > 0.45) {
          quality -= 0.12;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(dataUrl);
      } catch (e) {
        reject(e);
      }
    };
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

const ACCEPTED = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp'];

export function FmeaImageInput({ value, onChange, label, placeholder, disabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const setFile = useCallback(
    async (file: File | null) => {
      setError('');
      if (!file) return;
      if (!ACCEPTED.includes(file.type) && !/^image\//i.test(file.type)) {
        setError(`不支持的图片格式：${file.type || '未知'}`);
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError('图片过大（>10MB），请压缩后再粘贴或导入');
        return;
      }
      setBusy(true);
      try {
        const dataUrl = await compressToDataUrl(file);
        onChange(dataUrl);
      } catch (e) {
        setError(`图片处理失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    e.target.value = '';
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (disabled) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && /^image\//i.test(item.type)) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          setFile(file);
          return;
        }
      }
    }
  };

  const isImage = isImageDataUrl(value);
  const isPlaceholder = isImagePlaceholder(value);
  const hasText = !!value && !isImage && !isPlaceholder;

  return (
    <div
      ref={rootRef}
      className={`fmea-img-input ${focused ? 'focused' : ''}`}
      tabIndex={disabled ? -1 : 0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPaste={onPaste}
    >
      <div className="fmea-img-head">
        {label && <span className="mat-field-name">{label}</span>}
        <div className="fmea-img-actions">
          <button
            type="button"
            className="btn-ghost sm"
            disabled={disabled || busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? '处理中…' : '导入图片'}
          </button>
          <button
            type="button"
            className="btn-ghost sm"
            disabled={disabled || busy}
            onClick={() => rootRef.current?.focus()}
            title="点击后按 Ctrl+V 粘贴剪贴板中的图片"
          >
            粘贴
          </button>
          {(isImage || isPlaceholder || hasText) && (
            <button
              type="button"
              className="btn-link danger sm"
              disabled={disabled}
              onClick={() => {
                onChange('');
                setError('');
              }}
            >
              清除
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={onFileInput}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="fmea-img-body">
        {isImage ? (
          <div className="fmea-img-preview">
            <img src={value} alt={label || '图片'} />
            <span className="fmea-img-size">{(value.length / 1024).toFixed(1)} KB</span>
          </div>
        ) : isPlaceholder ? (
          <div className="fmea-img-placeholder">
            <span>原表内嵌图片，建议重新导入替换</span>
          </div>
        ) : hasText ? (
          <div className="fmea-img-text">{value}</div>
        ) : (
          <div className="fmea-img-empty">
            {busy
              ? '图片压缩中…'
              : focused
                ? '已激活，直接 Ctrl+V 粘贴'
                : placeholder || '未设置图片 · 点击「导入图片」或点此区域后 Ctrl+V 粘贴'}
          </div>
        )}
        {error && <div className="fmea-img-error">{error}</div>}
      </div>
    </div>
  );
}

/** 详情展示：dataURL 显示大图，placeholder 显示说明，空则不显示 */
export function FmeaImageCell({ value, label }: { value: string; label?: string }) {
  if (!value) return null;
  if (isImageDataUrl(value)) {
    return (
      <div className="fmea-img-preview">
        {label && <span className="fmea-img-preview-label">{label}</span>}
        <img src={value} alt={label || '图片'} />
      </div>
    );
  }
  if (isImagePlaceholder(value)) {
    return <span className="fmea-image-note">{label ? `${label}：` : ''}原表含图片，待补图</span>;
  }
  return <span className="fmea-image-note">{label ? `${label}：` : ''}{value}</span>;
}
