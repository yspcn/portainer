import { AccessControlFormData } from '../../../../portainer/components/accessControlForm/porAccessControlFormModel';
import { VolumesNFSFormData } from '../../../components/volumesNFSForm/volumesNFSFormModel';
import { VolumesCIFSFormData } from '../../../components/volumesCIFSForm/volumesCifsFormModel';

angular.module('portainer.docker').controller('CreateVolumeController', [
  '$q',
  '$scope',
  '$state',
  'VolumeService',
  'PluginService',
  'ResourceControlService',
  'Authentication',
  'Notifications',
  'FormValidator',
  'HttpRequestHelper',
  function ($q, $scope, $state, VolumeService, PluginService, ResourceControlService, Authentication, Notifications, FormValidator, HttpRequestHelper) {
    $scope.formValues = {
      Driver: 'local',
      DriverOptions: [],
      AccessControlData: new AccessControlFormData(),
      NodeName: null,
      NFSData: new VolumesNFSFormData(),
      CIFSData: new VolumesCIFSFormData(),
    };

    $scope.state = {
      formValidationError: '',
      actionInProgress: false,
    };

    $scope.availableVolumeDrivers = [];

    $scope.addDriverOption = function () {
      $scope.formValues.DriverOptions.push({ name: '', value: '' });
    };

    $scope.removeDriverOption = function (index) {
      $scope.formValues.DriverOptions.splice(index, 1);
    };

    function validateForm(accessControlData, isAdmin) {
      $scope.state.formValidationError = '';
      var error = '';
      error = FormValidator.validateAccessControl(accessControlData, isAdmin);

      if (error) {
        $scope.state.formValidationError = error;
        return false;
      }
      return true;
    }

    function prepareCIFSConfiguration(driverOptions) {
      const data = $scope.formValues.CIFSData;

      driverOptions.push({ name: 'type', value: 'cifs' });

      let share = data.share.replace('\\', '/');
      if (share[0] !== '/') {
        share = '/' + share;
      }
      const device = '//' + data.serverAddress + share;
      driverOptions.push({ name: 'device', value: device });

      const versionNumber = data.versionsNumber[data.versions.indexOf(data.version)];
      const options = 'username=' + data.username + ',password=' + data.password + ',vers=' + versionNumber;
      driverOptions.push({ name: 'o', value: options });
    }

    function prepareNFSConfiguration(driverOptions) {
      var data = $scope.formValues.NFSData;

      driverOptions.push({ name: 'type', value: data.version.toLowerCase() });

      var options = 'addr=' + data.serverAddress + ',' + data.options;
      driverOptions.push({ name: 'o', value: options });

      var mountPoint = data.mountPoint[0] === ':' ? data.mountPoint : ':' + data.mountPoint;
      driverOptions.push({ name: 'device', value: mountPoint });
    }

    $scope.create = function () {
      var name = $scope.formValues.Name;
      var driver = $scope.formValues.Driver;
      var driverOptions = $scope.formValues.DriverOptions;
      var storidgeProfile = $scope.formValues.StoridgeProfile;

      if (driver === 'cio:latest' && storidgeProfile) {
        driverOptions.push({ name: 'profile', value: storidgeProfile.Name });
      }

      if ($scope.formValues.NFSData.useNFS) {
        prepareNFSConfiguration(driverOptions);
      }

      if ($scope.formValues.CIFSData.useCIFS) {
        prepareCIFSConfiguration(driverOptions);
      }

      var volumeConfiguration = VolumeService.createVolumeConfiguration(name, driver, driverOptions);
      var accessControlData = $scope.formValues.AccessControlData;
      var userDetails = Authentication.getUserDetails();
      var isAdmin = Authentication.isAdmin();

      if (!validateForm(accessControlData, isAdmin)) {
        return;
      }

      var nodeName = $scope.formValues.NodeName;
      HttpRequestHelper.setPortainerAgentTargetHeader(nodeName);

      $scope.state.actionInProgress = true;
      VolumeService.createVolume(volumeConfiguration)
        .then(function success(data) {
          const userId = userDetails.ID;
          const resourceControl = data.ResourceControl;
          return ResourceControlService.applyResourceControl(userId, accessControlData, resourceControl);
        })
        .then(function success() {
          Notifications.success('Volume successfully created');
          $state.go('docker.volumes', {}, { reload: true });
        })
        .catch(function error(err) {
          Notifications.error('失败', err, '创建存储卷时出错');
        })
        .finally(function final() {
          $scope.state.actionInProgress = false;
        });
    };

    function initView() {
      var apiVersion = $scope.applicationState.endpoint.apiVersion;
      var endpointProvider = $scope.applicationState.endpoint.mode.provider;

      PluginService.volumePlugins(apiVersion < 1.25 || endpointProvider === 'VMWARE_VIC')
        .then(function success(data) {
          $scope.availableVolumeDrivers = data;
        })
        .catch(function error(err) {
          Notifications.error('失败', err, '无法检索存储卷驱动程序');
        });
    }

    initView();
  },
]);
