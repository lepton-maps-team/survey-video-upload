import { useState, useEffect } from 'react'
import Uppy from '@uppy/core'
import Tus from '@uppy/tus'
/**
 * Custom hook for configuring Uppy with Supabase authentication and TUS resumable uploads
 * @param {Object} options - Configuration options for the Uppy instance
 * @param {string} options.bucketName - The bucket name in Supabase where files are stored
 * @param {string} options.folder - Optional folder path within the bucket
 * @param {Object} options.restrictions - Optional upload restrictions
 * @param {string} options.accessToken - Optional access token for authentication
 * @param {string} options.surveyId - Optional survey ID for unique instance identification
 * @returns {Object} uppy - Uppy instance with configured upload settings
 */
export const useUppyWithSupabase = ({ 
  bucketName, 
  folder = '', 
  restrictions = {},
  accessToken = null,
  surveyId = null
}) => {
  const [uppy] = useState(() => {
    const uniqueId = `uppy-${bucketName}-${surveyId || folder}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const instance = new Uppy({
      id: uniqueId, // Use surveyId and random string for truly unique IDs
      autoProceed: true,
      allowMultipleUploadBatches: false,
      restrictions: {
        maxNumberOfFiles: 1,
        allowedFileTypes: ['video/*'],
        ...restrictions
      }
    }).use(Tus, {
      endpoint: `https://bharatnet.survey.rio.software/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE`
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      allowedMetaFields: [
        'bucketName',
        'objectName',
        'contentType',
        'cacheControl',
      ]
    })

    return instance
  })

  // Handle file metadata
  useEffect(() => {
    const handleFileAdded = (file) => {
      const objectName = folder ? `${folder}/${file.name}` : file.name
      file.meta = {
        ...file.meta,
        bucketName,
        objectName,
        contentType: file.type,
      }
    }

    uppy.on('file-added', handleFileAdded)
    return () => {
      uppy.off('file-added', handleFileAdded)
    }
  }, [uppy, bucketName, folder])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      uppy.cancelAll()
    }
  }, [uppy])

  // Update authorization header when accessToken changes
  // useEffect(() => {
  //   if (accessToken) {
  //     const tusPlugin = uppy.getPlugin('Tus')
  //     if (tusPlugin) {
  //       tusPlugin.opts.headers.authorization = `Bearer ${accessToken}`
  //     }
  //   }
  // }, [uppy, accessToken])

  return uppy
} 