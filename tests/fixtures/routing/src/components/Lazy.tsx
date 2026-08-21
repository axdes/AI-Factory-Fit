import { lazy } from 'react'
const Modal = lazy(() => import('./Modal'))
export default function Lazy() { return <Modal /> }
