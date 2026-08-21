import { Route, Switch } from 'react-router-dom'
import lazy from '~/utils/lazyWithRetry'
import Login from '../scenes/Login'

const Dashboard = lazy(() => import('../scenes/Dashboard'))

export default function Routes() {
  return (
    <Switch>
      <Route exact path="/login" component={Login} />
      <Route exact path="/" component={Dashboard} />
    </Switch>
  )
}
