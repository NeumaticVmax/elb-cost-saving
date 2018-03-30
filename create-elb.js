/**
 * ロードバランサとターゲットグループを作成し、DNSレコードを更新する。
 * このツールは停止ができないELBでランニングコストを下げるために作成した。
 * 戦略は
 *   1. EC2インスタンスの停止時にELBを削除する。(delete-elb.js)
 *   2. EC2インスタンスの起動時にこのツールを実行する。
 *      ツールにより以下の処理が実行される。
 *        2-1. ロードバランサとターゲットグループを作成する
 *        2-2. ロードバランサのDNS名をRoute53に登録する(UPSERT)
 *        2-3. EC2インスタンスのDNS名をRoute53に登録する(UPSERT)
 */

// const proxy = require('proxy-agent')
const AWS = require('aws-sdk')
const axios = require('axios')
const myConfig = require('config')

const credentials = new AWS.SharedIniFileCredentials({profile: myConfig.profile})

AWS.config.update({
  credentials: credentials,
  region: myConfig.region
  // httpOptions: {agent: proxy('http://192.168.128.21:3128')}
})

const elbv2 = new AWS.ELBv2({apiVersion: '2015-12-01'})
const route53 = new AWS.Route53({apiVersion: '2013-04-01'})

/**
 * aws-sdk に渡すパラメータをまとめて管理するオブジェクト
 * 一部のパラメータはSDKからの戻り値がセットされる。
 * @type {Object}
 */
const params = {
  /**
   * ELBを作成する時に必要なパラメータ
   * @type {Object}
   */
  elb: {
    Name: myConfig.nameElb,
    Subnets: [...myConfig.subnetsElb],
    SecurityGroups: [...myConfig.SecurityGroupsElb]
  },
  /**
   * ターゲットグループを作成するときに必要なパラメータ
   * @type {Object}
   */
  targetGroup: {
    Name: myConfig.nameTargetGroup,
    Port: 10000,
    Protocol: 'HTTP',
    VpcId: myConfig.vpcTargetGroup
  },
  /**
   * ターゲットグループにターゲットを登録するときに必要なパラメータ
   * @type {Object}
   */
  registerTargets: {
    Targets: [{Id: myConfig.targetInstance}]
  },
  /**
   * ロードバランサにリスナーを登録するときに必要なパラメータ
   * @type {Object}
   */
  createListener: {
    DefaultActions: [
      {
        Type: 'forward'
      }
    ],
    Port: 443,
    Protocol: 'HTTPS',
    Certificates: [
      {
        CertificateArn: myConfig.certificateArn
      }
    ]
  },
  route53: {
    ChangeBatch: {
      Changes: [
        {
          Action: 'UPSERT',
          ResourceRecordSet: {
            Name: myConfig.cnameEc2,
            Type: 'CNAME',
            TTL: 300,
            ResourceRecords: []
          }
        },
        {
          Action: 'UPSERT',
          ResourceRecordSet: {
            Name: myConfig.cnameElb,
            Type: 'CNAME',
            TTL: 300,
            ResourceRecords: []
          }
        }
      ]
    },
    HostedZoneId: myConfig.hostedZoneId
  }
}

/**
 * ロードバランサを作成するための関数
 * @return {[PromiseObject]} Promiseオブジェクトを返す
 */
function myCreateLoadBalancer () {
  return new Promise((resolve, reject) => {
    elbv2.createLoadBalancer(params.elb, (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}

/**
 * ターゲットグループを作成するための関数
 * @return {PromiseObject} Promiseオブジェクトを返す
 */
function myCreateTargetGroup () {
  return new Promise((resolve, reject) => {
    elbv2.createTargetGroup(params.targetGroup, (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}

/**
 * ターゲットをターゲットグループに登録するための関数
 * @return {PromiseObject} Promiseオブジェクトを返す
 */
function myResisterTargets () {
  return new Promise((resolve, reject) => {
    elbv2.registerTargets(params.registerTargets, (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}

/**
 * ロードバランサにリスナーを作成するための関数
 * @return {PromiseObject} Promiseオブジェクトを返す
 */
function myCreateListener () {
  return new Promise((resolve, reject) => {
    elbv2.createListener(params.createListener, (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}

/**
 * Route53のレコードを更新するための関数
 * @return {PromiseObject} Promiseオブジェクトを返す
 */
function myChangeResourceRecordSets () {
  return new Promise((resolve, reject) => {
    route53.changeResourceRecordSets(params.route53, (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}

async function main () {
  const ec2DnsName = await axios.get(myConfig.endpoint)
  const elb = await myCreateLoadBalancer()
  const targetGroup = await myCreateTargetGroup()

  params.route53.ChangeBatch.Changes[0].ResourceRecordSet.ResourceRecords = [{Value: ec2DnsName.data}]
  params.route53.ChangeBatch.Changes[1].ResourceRecordSet.ResourceRecords = [{Value: elb.LoadBalancers[0].DNSName}]
  params.createListener.LoadBalancerArn = elb.LoadBalancers[0].LoadBalancerArn
  params.createListener.DefaultActions[0].TargetGroupArn = targetGroup.TargetGroups[0].TargetGroupArn
  params.registerTargets.TargetGroupArn = targetGroup.TargetGroups[0].TargetGroupArn

  try {
    await myResisterTargets()
    await myCreateListener()
    await myChangeResourceRecordSets()
  } catch (err) {
    console.log(err)
  }
}

main()
