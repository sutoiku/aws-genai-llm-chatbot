import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sagemaker from 'aws-cdk-lib/aws-sagemaker';
import { Construct } from 'constructs';

import { ContainerImages } from './container-images';
import { ImageRepositoryMapping } from './image-repository-mapping';
import { LargeLanguageModelProps, ModelContainerConfig } from './types';

export function deployContainerModel(scope: Construct, props: LargeLanguageModelProps, modelConfig: ModelContainerConfig) {
  const { vpc, region } = props;
  const { modelId, instanceType, env = {} } = modelConfig;

  const executionRole = new iam.Role(scope, 'SageMakerExecutionRole', {
    assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
    managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess')],
  });

  const containerImage = modelConfig.container || ContainerImages.HF_PYTORCH_LLM_TGI_INFERENCE_LATEST;
  const imageMapping = new ImageRepositoryMapping(scope, 'ContainerModelMapping', { region });
  const image = `${imageMapping.account}.dkr.ecr.${region}.amazonaws.com/${containerImage}`;

  const model = new sagemaker.CfnModel(scope, 'Model', {
    executionRoleArn: executionRole.roleArn,
    primaryContainer: {
      image,
      mode: 'SingleModel',
      environment: {
        SAGEMAKER_CONTAINER_LOG_LEVEL: '20',
        SAGEMAKER_REGION: region,
        HF_MODEL_ID: modelId,
        ...env,
      },
    },
    vpcConfig: {
      subnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      }).subnetIds,
      securityGroupIds: [vpc.vpcDefaultSecurityGroup],
    },
  });

  const endpointConfig = new sagemaker.CfnEndpointConfig(scope, 'EndpointConfig', {
    productionVariants: [
      {
        instanceType,
        initialVariantWeight: 1,
        initialInstanceCount: 1,
        variantName: 'AllTraffic',
        modelName: model.getAtt('ModelName').toString(),
        containerStartupHealthCheckTimeoutInSeconds: 900,
      },
    ],
  });

  endpointConfig.addDependency(model);

  const endpoint = new sagemaker.CfnEndpoint(scope, modelId, {
    endpointConfigName: endpointConfig.getAtt('EndpointConfigName').toString(),
  });

  endpoint.addDependency(endpointConfig);

  return { model, endpoint };
}
