import styles from './RoleIndicator.module.css';
export default function RoleIndicator({role}) {
  return <>
    {role.imposter ? <div className={`${styles.imposter} ${styles.container}`}>
      You're the Imposter
    </div> :
    <div className={`${styles.crewmate} ${styles.container}`}>
      You're a Crewmate
    </div>}
  </>
}
