import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import '@xyflow/react/dist/style.css';
import './styles.css';
import Application from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#1677ff', colorBgBase: '#061426', colorBgContainer: '#0b1f36', colorText: '#f5f8ff', colorTextSecondary: '#9fb3c8', borderRadius: 10, fontFamily: 'Inter, "Microsoft YaHei", sans-serif' } }}>
      <AntApp><Application /></AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
