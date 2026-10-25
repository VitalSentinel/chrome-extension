import { render } from 'preact';
import '../../ui/tokens.css';
import { App } from '../../popup/App';

render(<App />, document.getElementById('app')!);
