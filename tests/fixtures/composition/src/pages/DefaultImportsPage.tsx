// Every component here arrives as a default export, and none of the import paths
// contain the word "components". Both facts were once enough to make this file
// read as 100% hand-written markup.
import Layout from '@theme/Layout'
import Heading from '@theme/Heading'
import Link from '@docusaurus/Link'
import styles from './styles.module.css'

export default function DefaultImportsPage() {
  return (
    <Layout>
      <Heading as="h1">Title</Heading>
      <Link to="/a">A</Link>
      <Link to="/b">B</Link>
      <div className={styles.footer}>plain markup</div>
    </Layout>
  )
}
