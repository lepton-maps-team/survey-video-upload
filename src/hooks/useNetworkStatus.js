import { useEffect, useState } from "react";

const getNavigatorStatus = () =>
  typeof navigator === "undefined" ? true : navigator.onLine;

const useNetworkStatus = () => {
  const [isOnline, setOnline] = useState(getNavigatorStatus());
  
 //s] console.log(isOnline, "status");
  
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    
    const updateNetworkStatus = () => {
      const status = getNavigatorStatus();
      console.log("Network status changed:", status);
      setOnline(status);
    };
    
    // Remove 'load' event - it's unnecessary and won't fire after mount
    window.addEventListener("online", updateNetworkStatus);
    window.addEventListener("offline", updateNetworkStatus);
    
    return () => {
      window.removeEventListener("online", updateNetworkStatus);
      window.removeEventListener("offline", updateNetworkStatus);
    };
  }, []);
  
  return { isOnline };
};

export default useNetworkStatus;