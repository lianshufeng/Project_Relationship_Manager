import React from 'react';
import { Button, Result } from 'antd';

export class ErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <Result status="error" title="页面暂时无法显示" subTitle="请刷新页面后重试。" extra={<Button type="primary" onClick={() => location.reload()}>刷新页面</Button>} />;
    return this.props.children;
  }
}
