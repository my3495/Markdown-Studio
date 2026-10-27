import { useEffect, useMemo, useState } from 'react';
import type { Root } from 'hast';
import { render, splitSlides } from '@md-studio/core';
import { MarkdownPreview } from '../preview/MarkdownPreview';
import { getRenderOptions, useSettings } from '../../stores/settings';
import { Icon } from '../../components/Icon';
import { t } from '../../i18n';

interface Props {
  content: string;
  title: string;
  onClose: () => void;
  onOpenWiki?: (name: string) => void;
}

export function SlideShow({ content, title, onClose, onOpenWiki }: Props) {
  const s = useSettings();
  const slides = useMemo(() => splitSlides(content), [content]);
  const [index, setIndex] = useState(0);
  const [hast, setHast] = useState<Root | null>(null);

  const safeIndex = Math.min(index, Math.max(0, slides.length - 1));

  useEffect(() => {
    let cancelled = false;
    const md = slides[safeIndex] ?? '';
    void render(md, getRenderOptions(s)).then((r) => {
      if (!cancelled) setHast(r.hast);
    });
    return () => {
      cancelled = true;
    };
  }, [slides, safeIndex, s]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, slides.length - 1));
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Home') {
        e.preventDefault();
        setIndex(0);
      }
      if (e.key === 'End') {
        e.preventDefault();
        setIndex(slides.length - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, slides.length]);

  return (
    <div className="slideshow" role="dialog" aria-modal="true" aria-label={title}>
      <div className="slideshow-bar">
        <span className="slideshow-title">{title}</span>
        <span className="slideshow-progress">
          {safeIndex + 1} / {slides.length}
        </span>
        <button className="tb-btn" type="button" onClick={onClose} title={t(s.locale, 'close')}>
          <Icon name="close" />
          <span className="tb-label">{t(s.locale, 'close')}</span>
        </button>
      </div>
      <div
        className="slideshow-stage"
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          const x = e.clientX - rect.left;
          if (x > rect.width * 0.6) setIndex((i) => Math.min(i + 1, slides.length - 1));
          else if (x < rect.width * 0.4) setIndex((i) => Math.max(i - 1, 0));
        }}
      >
        <div className="slideshow-slide">
          <MarkdownPreview hast={hast} onOpenWiki={onOpenWiki} />
        </div>
      </div>
      <div className="slideshow-nav">
        <button
          type="button"
          className="ui-btn"
          disabled={safeIndex <= 0}
          onClick={() => setIndex((i) => Math.max(i - 1, 0))}
        >
          ←
        </button>
        <button
          type="button"
          className="ui-btn"
          disabled={safeIndex >= slides.length - 1}
          onClick={() => setIndex((i) => Math.min(i + 1, slides.length - 1))}
        >
          →
        </button>
      </div>
    </div>
  );
}
