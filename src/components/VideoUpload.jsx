import { useEffect, useState, useCallback } from 'react'
import { Dashboard } from '@uppy/react'
import { useUppyWithSupabase } from '../hooks/useUppyWithSupabase'
import "@uppy/core/dist/style.min.css"
import "@uppy/dashboard/dist/style.min.css"

function VideoUpload({ surveyId, onUploadComplete }) {
  const [isUploading, setIsUploading] = useState(false)
  
  const uppy = useUppyWithSupabase({
    bucketName: 'videos',
    folder: surveyId
  })

  const handleComplete = useCallback((result) => {
    setIsUploading(false)
    if (result.successful?.length > 0) {
      const uploadedFile = result.successful[0]
      onUploadComplete(surveyId, uploadedFile.name)
    }
  }, [surveyId, onUploadComplete])

  const handleError = useCallback((file, error) => {
    setIsUploading(false)
    console.error('Upload error:', error)
  }, [])

  const handleUploadStart = useCallback(() => {
    setIsUploading(true)
  }, [])

  useEffect(() => {
    uppy.on('upload', handleUploadStart)
    return () => uppy.off('upload', handleUploadStart)
  }, [uppy, handleUploadStart])

  useEffect(() => {
    uppy.on('complete', handleComplete)
    return () => uppy.off('complete', handleComplete)
  }, [uppy, handleComplete])

  useEffect(() => {
    uppy.on('upload-error', handleError)
    return () => uppy.off('upload-error', handleError)
  }, [uppy, handleError])

  return (
    <div className={`upload-container ${isUploading ? 'uploading' : ''}`}>
      <Dashboard
        uppy={uppy}
        inline={true}
        // showProgressDetails={true}
        proudlyDisplayPoweredByUppy={false}
        height={150}
        width={300}
        showRemoveButtonAfterComplete={false}
      />
    </div>
  )
}

export default VideoUpload 