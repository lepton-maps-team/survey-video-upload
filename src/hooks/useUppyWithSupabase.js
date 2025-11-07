import { useState, useEffect } from 'react'
import Uppy from '@uppy/core'
import Tus from '@uppy/tus'
import { useQueueStore } from '../lib/store'
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
  bucketName, z,
  folder = '', 
  restrictions = {},
  accessToken = null,
  surveyId = null
}) => {

  const addToQueue = useQueueStore((state) => state.addToQueue)

  const [uppy] = useState(() => {
    const uniqueId = `uppy-${bucketName}-${surveyId || folder}`
    const instance = new Uppy({
      id: uniqueId, // Use surveyId and random string for truly unique IDs
      autoProceed: false,
      allowMultipleUploadBatches: false,
      restrictions: {
        maxNumberOfFiles: 1,
        allowedFileTypes: ['video/*'],
        ...restrictions
      }
    }).use(Tus, {
      endpoint: `https://uploads.signals.rio.software/files/`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      allowedMetaFields: [
        'bucketName',
        'objectName',
        'contentType',
        'cacheControl',
        'filetype',
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
        filetype: file.type
      }
      
      if (surveyId) {
        addToQueue(surveyId)
      }
    }

    const handleError = async (error) => {
      console.log('error', error);
      if (surveyId) {
        const { error: error2 } = await supabase.from("upload_errors").insert({
          survey_id: surveyId,
          error: JSON.stringify(error),
        });
        if (error2) {
          console.error("Error inserting upload error:", error2);
        }
      }
    }

    uppy.on('file-added', handleFileAdded)
    uppy.on('error', handleError)
    return () => {
      uppy.off('file-added', handleFileAdded)
        uppy.off('error', handleError)
    }
  }, [uppy, bucketName, folder, surveyId, addToQueue])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      uppy.cancelAll()
    }
  }, [uppy])

  return uppy
} 