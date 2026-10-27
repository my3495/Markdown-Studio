import type { ComponentProps } from 'react';

/** 图片组件：懒加载；Web 端相对路径直接回退为原 src。 */
export function Image(props: ComponentProps<'img'>) {
  return <img {...props} loading="lazy" />;
}
