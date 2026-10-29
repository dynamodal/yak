import './home.css';
import { registerView } from '../app/registry';
import { IconHome } from '../app/ui';
import { HomeView } from './HomeView';

// Home is the first tab and, while it is on, the landing page (F-33p). Other modules add its cards (`registerHomeCard`, src/app/home-cards.tsx).
registerView({ id: 'home', title: 'Home', path: 'home', order: 5, icon: IconHome, component: HomeView });
