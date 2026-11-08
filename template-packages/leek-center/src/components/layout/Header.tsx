import { Layout, Menu } from 'antd';
import Styles from './Header.module.less';
import { useHistory } from 'react-router-dom';
import { MenuInfo } from 'rc-menu/lib/interface';
import { useEffect, useState } from 'react';
const { Header } = Layout;

export default function LHeader() {
  let history = useHistory();

  const [defaultSelectedKeys, setDefaultSelectedKeys] = useState('');

  useEffect(() => {
    const currentRootPathname = history.location.pathname.split('/')[1];
    setDefaultSelectedKeys('/' + currentRootPathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  console.log('defaultSelectedKeys: ', defaultSelectedKeys);

  function handleClick(e: MenuInfo) {
    setDefaultSelectedKeys(e.key.toString());
    history.replace(e.key.toString());
  }

  return (
    <Header className={Styles.header}>
      <div className={Styles.logo}>行情中心</div>
      <Menu
        onClick={handleClick}
        // theme="dark"
        mode="horizontal"
        selectedKeys={[defaultSelectedKeys]}
      >
        <Menu.Item key="/my-stocks">我的自选</Menu.Item>
        <Menu.Item key="/data-center">数据中心</Menu.Item>
      </Menu>
    </Header>
  );
}
