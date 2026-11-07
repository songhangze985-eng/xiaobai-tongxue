/**
 * 篇章条 —— 吸顶导航下的一线细带。
 * 只落一枚朱文小印 + 当前回目;卷名与旁白均已删(用户定案),不铺整卷回目。
 * 路径不命中任何篇章时整条不渲染。
 */
import { useEffect, useState } from 'react';
import styles from './storyTrail.module.css';

interface StoryStage {
  chapter: string;
  label: string;
  test: RegExp;
}

const STAGES: StoryStage[] = [
  { chapter: '序', label: '收下小白', test: /^\/study\/?$/ },
  { chapter: '壹', label: '灯下温书', test: /^\/prep\// },
  { chapter: '贰', label: '学堂开讲', test: /^\/teach\// },
  { chapter: '叁', label: '送徒赴考', test: /^\/exam\// },
  { chapter: '肆', label: '灯下批注', test: /^\/review\// },
  { chapter: '长卷', label: '见证成长', test: /^\/growth\/?$/ },
];

export function StoryTrail({ pathname }: { pathname: string }) {
  const active = STAGES.findIndex((stage) => stage.test.test(pathname));
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (active < 0) return undefined;
    const timer = window.setTimeout(() => setCollapsed(true), 5000);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (active < 0) return null;

  const current = STAGES[active];

  return (
    <section
      className={styles.wrap}
      aria-label={`师徒一课，当前篇章：${current.chapter}，${current.label}`}
      aria-hidden={collapsed || undefined}
      data-collapsed={collapsed || undefined}
    >
      <div className={styles.clip}>
        <div className={styles.inner}>
          <p className={styles.current}>
            <span className={styles.chapter} aria-hidden="true">{current.chapter}</span>
            <strong className={styles.label}>{current.label}</strong>
          </p>
        </div>
      </div>
    </section>
  );
}
