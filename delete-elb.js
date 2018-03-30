/**
 * ロードバランサとターゲットグループを削除する。
 */
const AWS = require('aws-sdk')
const myConfig = require('config')

const credentials = new AWS.SharedIniFileCredentials({profile: myConfig.profile})

AWS.config.update({
  credentials: credentials,
  region: myConfig.region
})

const elbv2 = new AWS.ELBv2({apiVersion: '2015-12-01'})

const params = {
  elb: {
    Names: [myConfig.nameElb]
  },
  deleteElb: {
    LoadBalancerArn: ''
  },
  targetGroup: {
    Names: [myConfig.nameTargetGroup]
  },
  deleteTargetGroup: {
    TargetGroupArn: ''
  }
}

/**
 * ロードバランサを削除する
 * @return {Object} Promiseオブジェクトを返す
 */
function deleteLoadBalancer () {
  return new Promise((resolve, reject) => {
    elbv2.describeLoadBalancers(params.elb, (err, data) => {
      if (err) {
        reject(err)
      } else {
        const loadBalancerArn = data.LoadBalancers[0].LoadBalancerArn
        params.deleteElb.LoadBalancerArn = loadBalancerArn
        elbv2.deleteLoadBalancer(params.deleteElb, (err, data) => {
          if (err) {
            reject(err)
          } else {
            resolve(data)
          }
        })
      }
    })
  })
}

/**
 * ターゲットグループを削除する
 * @return {Object} Promiseオブジェクトを返す
 */
function deleteTargetGroup () {
  return new Promise((resolve, reject) => {
    elbv2.describeTargetGroups(params.targetGroup, (err, data) => {
      if (err) {
        reject(err)
      } else {
        const targetGroupArn = data.TargetGroups[0].TargetGroupArn
        params.deleteTargetGroup.TargetGroupArn = targetGroupArn
        // ロードバランサとの紐づけが解放されるのを待つ
        elbv2.waitFor('targetDeregistered', params.deleteTargetGroup, (err, data) => {
          if (err) {
            reject(err)
          } else {
            // 紐づけが解放されたらターゲットグループを削除する
            elbv2.deleteTargetGroup(params.deleteTargetGroup, (err, data) => {
              if (err) {
                reject(err)
              } else {
                resolve(data)
              }
            })
          }
        })
      }
    })
  })
}

async function main () {
  try {
    await deleteLoadBalancer()
    await deleteTargetGroup()
  } catch (err) {
    console.log(err.code)
    if (err.code === 'LoadBalancerNotFound') {
      try {
        await deleteTargetGroup()
      } catch (err) {
        console.log(err.code)
        if (err.code !== 'TargetGroupNotFound') {
          console.log(err)
          process.exit(1)
        }
      }
    } else {
      console.log(err)
      process.exit(1)
    }
  }
}

main()
